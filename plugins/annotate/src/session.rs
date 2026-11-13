//! One annotation at a time: idle → starting → recording → finishing → idle.
//! The native layer's blocking calls run on worker threads; while recording,
//! its events are polled every 100 ms and acted on here, so a recording the
//! capsule or the 20-minute cap ended reaches the frontend as a `Stopped`
//! event like one the shortcut ended.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anlg_annotate_core::retention::Preset;
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::audio::{Clock, Narrated, Narration};
use crate::bundle::{CANDIDATES_DIR, Finalized, TranscriptInput};
use crate::events::{AnnotateEvent, Stopped};
use crate::native::{Candidate, Event, Native, StartReply, StopResult};
use crate::{Error, bundle};

const POLL: Duration = Duration::from_millis(100);

pub type Emit = Arc<dyn Fn(AnnotateEvent) + Send + Sync>;
/// Takes Escape from other apps (`true`) while ink is on, and gives it back.
/// Called under the session's lock, so calls arrive in order; it must not
/// block.
pub type Escape = Arc<dyn Fn(bool) + Send + Sync>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Idle,
    Starting,
    Recording,
    Finishing,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// False off macOS, where nothing records.
    pub available: bool,
    pub phase: Phase,
    /// The recording that stopped and waits for `finalize` or `cancel`.
    pub stopped: Option<Stopped>,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    pub id: String,
    pub dir: String,
}

/// The capsule's words in the app's language.
#[derive(Clone, Debug, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CapsuleLabels {
    pub discard_question: Option<String>,
    pub discard: Option<String>,
    pub keep: Option<String>,
}

struct Active {
    id: String,
    dir: PathBuf,
    narration: Narration,
    poll: CancellationToken,
    start: StartReply,
}

struct Finishing {
    id: String,
    dir: PathBuf,
    /// Taken while it is being finalized.
    stop: Option<(StopResult, Stopped)>,
    /// A discard came while it was being stopped or finalized: it wins.
    discard: bool,
    /// Finalizing failed once; the next failure gives up.
    retried: bool,
}

impl Finishing {
    fn new(id: String, dir: PathBuf) -> Self {
        Self {
            id,
            dir,
            stop: None,
            discard: false,
            retried: false,
        }
    }
}

enum State {
    Idle,
    /// `cancel` asks the start to undo itself once the native layer answers.
    Starting {
        cancel: bool,
    },
    Recording(Box<Active>),
    Finishing(Box<Finishing>),
}

pub struct Session {
    native: Arc<dyn Native>,
    clock: Arc<dyn Clock>,
    root: PathBuf,
    emit: Emit,
    escape: Escape,
    state: Mutex<State>,
    retention: Mutex<Option<Preset>>,
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, Error> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| Error::Task(error.to_string()))
}

/// Creates the annotations folder, readable by this user only.
pub fn ensure_root(root: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(root)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// The candidate frames the native layer wrote, from their file names
/// (`{t_ms:08}.jpg`).
fn candidates_in(dir: &Path) -> Vec<Candidate> {
    let Ok(entries) = std::fs::read_dir(dir.join(CANDIDATES_DIR)) else {
        return Vec::new();
    };
    let mut candidates: Vec<Candidate> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let t_ms = path.file_stem()?.to_str()?.parse().ok()?;
            (path.extension()? == "jpg").then(|| Candidate {
                t_ms,
                path: path.to_string_lossy().into_owned(),
            })
        })
        .collect();
    candidates.sort_by_key(|candidate| candidate.t_ms);
    candidates
}

impl Session {
    pub fn new(
        native: Arc<dyn Native>,
        clock: Arc<dyn Clock>,
        root: PathBuf,
        emit: Emit,
        escape: Escape,
    ) -> Self {
        Self {
            native,
            clock,
            root,
            emit,
            escape,
            state: Mutex::new(State::Idle),
            retention: Mutex::new(None),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn native(&self) -> &Arc<dyn Native> {
        &self.native
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn set_idle(&self) {
        *self.lock() = State::Idle;
    }

    pub fn status(&self) -> Status {
        let state = self.lock();
        let (phase, stopped) = match &*state {
            State::Idle => (Phase::Idle, None),
            State::Starting { .. } => (Phase::Starting, None),
            State::Recording(_) => (Phase::Recording, None),
            State::Finishing(finishing) => (
                Phase::Finishing,
                finishing.stop.as_ref().map(|(_, stopped)| stopped.clone()),
            ),
        };
        Status {
            available: cfg!(target_os = "macos"),
            phase,
            stopped,
        }
    }

    /// Opens the microphone, then starts the native recording into a new
    /// bundle folder.
    pub async fn start(
        self: &Arc<Self>,
        audio: Arc<dyn anlg_audio::AudioProvider>,
        microphone: Option<String>,
        labels: Option<CapsuleLabels>,
    ) -> Result<Started, Error> {
        {
            let mut state = self.lock();
            match &*state {
                State::Idle => *state = State::Starting { cancel: false },
                State::Starting { .. } => return Err(Error::Busy("starting")),
                State::Recording(_) => return Err(Error::Busy("recording")),
                State::Finishing(_) => return Err(Error::Busy("finishing")),
            }
        }
        let id = anlg_annotate_core::new_bundle_id();
        let dir = self.root.join(&id);
        let started = self.begin(&id, &dir, audio, microphone, labels).await;
        if started.is_err() {
            let _ = std::fs::remove_dir_all(&dir);
            self.set_idle();
        }
        started
    }

    async fn begin(
        self: &Arc<Self>,
        id: &str,
        dir: &Path,
        audio: Arc<dyn anlg_audio::AudioProvider>,
        microphone: Option<String>,
        labels: Option<CapsuleLabels>,
    ) -> Result<Started, Error> {
        ensure_root(&self.root)?;
        std::fs::create_dir_all(dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        }
        let narration = Narration::start(
            audio,
            microphone,
            dir.join(anlg_annotate_core::AUDIO_FILE),
            self.clock.clone(),
        )?;
        let request = anlg_annotate_macos::StartRequest {
            dir: dir.to_string_lossy().into_owned(),
            labels: labels.map(|labels| anlg_annotate_macos::Labels {
                discard_question: labels.discard_question,
                discard: labels.discard,
                keep: labels.keep,
            }),
        }
        .to_json();
        let native = self.native.clone();
        let reply = match blocking(move || native.start(&request)).await {
            Ok(Ok(reply)) => reply,
            Ok(Err(error)) => {
                narration.cancel().await;
                return Err(error.into());
            }
            Err(error) => {
                narration.cancel().await;
                return Err(error);
            }
        };
        let start: StartReply = match serde_json::from_str(&reply) {
            Ok(start) => start,
            Err(error) => {
                narration.cancel().await;
                let native = self.native.clone();
                let _ = blocking(move || native.cancel()).await;
                return Err(Error::Native(error.to_string()));
            }
        };
        narration.begin_at(start.started_host_ns);
        let poll = CancellationToken::new();
        let active = Box::new(Active {
            id: id.to_owned(),
            dir: dir.to_path_buf(),
            narration,
            poll: poll.clone(),
            start,
        });
        let cancelled = {
            let mut state = self.lock();
            if matches!(&*state, State::Starting { cancel: true }) {
                Some(active)
            } else {
                *state = State::Recording(active);
                None
            }
        };
        if let Some(active) = cancelled {
            // Quit, or a discard, while the native layer was starting.
            let native = self.native.clone();
            let (cancelled, ()) =
                tokio::join!(blocking(move || native.cancel()), active.narration.cancel());
            if let Ok(Err(error)) = cancelled {
                tracing::warn!(%error, "annotate cancel after start");
            }
            return Err(Error::Cancelled);
        }
        let session = self.clone();
        tauri::async_runtime::spawn(async move { session.poll(poll).await });
        Ok(Started {
            id: id.to_owned(),
            dir: dir.to_string_lossy().into_owned(),
        })
    }

    /// Sends the ink's Escape to the shortcut while still recording.
    fn escape_while_recording(&self, on: bool) {
        let state = self.lock();
        if matches!(&*state, State::Recording(_)) {
            (self.escape)(on);
        }
    }

    async fn poll(self: Arc<Self>, poll: CancellationToken) {
        loop {
            tokio::select! {
                _ = poll.cancelled() => return,
                _ = tokio::time::sleep(POLL) => {}
            }
            let events = match self.native.poll_events() {
                Ok(json) => serde_json::from_str::<Vec<Event>>(&json).unwrap_or_default(),
                Err(error) => {
                    tracing::warn!(%error, "annotate events");
                    continue;
                }
            };
            for event in events {
                match event.kind.as_str() {
                    "stop" | "stopped" => {
                        match self.stop().await {
                            Ok(stopped) => (self.emit)(AnnotateEvent::Stopped { stopped }),
                            // The shortcut's stop got there first.
                            Err(Error::NotRecording) => {}
                            Err(Error::Cancelled) => (self.emit)(AnnotateEvent::Discarded),
                            Err(error) => (self.emit)(AnnotateEvent::Failed {
                                message: error.to_string(),
                            }),
                        }
                        return;
                    }
                    "discard" => {
                        match self.cancel().await {
                            Ok(()) => (self.emit)(AnnotateEvent::Discarded),
                            Err(error) => (self.emit)(AnnotateEvent::Failed {
                                message: error.to_string(),
                            }),
                        }
                        return;
                    }
                    "pen_on" => {
                        self.escape_while_recording(true);
                        (self.emit)(AnnotateEvent::Ink { on: true });
                    }
                    "pen_off" | "ink_off" => {
                        self.escape_while_recording(false);
                        (self.emit)(AnnotateEvent::Ink { on: false });
                    }
                    _ => {}
                }
            }
        }
    }

    /// Stops the screen and the microphone. The recording then waits for
    /// [`Session::finalize`].
    pub async fn stop(&self) -> Result<Stopped, Error> {
        let active = {
            let mut state = self.lock();
            if !matches!(&*state, State::Recording(_)) {
                return Err(Error::NotRecording);
            }
            let State::Recording(active) = std::mem::replace(&mut *state, State::Idle) else {
                unreachable!()
            };
            *state = State::Finishing(Box::new(Finishing::new(
                active.id.clone(),
                active.dir.clone(),
            )));
            (self.escape)(false);
            active
        };
        let Active {
            id,
            dir,
            narration,
            poll,
            start,
        } = *active;
        poll.cancel();
        let native = self.native.clone();
        let (result, narrated) = tokio::join!(blocking(move || native.stop()), narration.stop());
        let narrated: Option<Narrated> = narrated
            .inspect_err(|error| tracing::warn!(%error, "annotate narration"))
            .ok();
        let result = match result.and_then(|reply| reply.map_err(Error::from)) {
            Ok(json) => serde_json::from_str::<StopResult>(&json)
                .map_err(|error| Error::Native(error.to_string())),
            Err(error) => Err(error),
        };
        let result = match result {
            Ok(result) => result,
            Err(error) => match self.salvage(&dir, &start, narrated.as_ref(), &error) {
                Some(result) => result,
                None => {
                    let _ = std::fs::remove_dir_all(&dir);
                    self.set_idle();
                    return Err(error);
                }
            },
        };
        let audio_path = narrated
            .filter(|narrated| narrated.samples > 0)
            .map(|narrated| narrated.path.to_string_lossy().into_owned());
        let stopped = Stopped {
            id: id.clone(),
            dir: dir.to_string_lossy().into_owned(),
            audio_path,
            duration_ms: u32::try_from(result.duration_ms.max(0)).unwrap_or(u32::MAX),
            ended_by: result.ended_by.clone(),
            warnings: result.warnings.clone(),
        };
        let mut state = self.lock();
        if let State::Finishing(finishing) = &mut *state
            && finishing.id == id
        {
            if finishing.discard {
                *state = State::Idle;
                drop(state);
                let _ = std::fs::remove_dir_all(&dir);
                return Err(Error::Cancelled);
            }
            finishing.stop = Some((result, stopped.clone()));
        }
        Ok(stopped)
    }

    /// When the native stop failed: what the recording left that is still
    /// worth finishing (the narration, the candidate frames), as a stop
    /// result without a movie or ink. None when nothing is.
    fn salvage(
        &self,
        dir: &Path,
        start: &StartReply,
        narrated: Option<&Narrated>,
        error: &Error,
    ) -> Option<StopResult> {
        let candidates = candidates_in(dir);
        let heard = narrated.is_some_and(|narrated| narrated.samples > 0);
        if candidates.is_empty() && !heard {
            return None;
        }
        tracing::warn!(%error, "annotate stop failed; finishing without the movie");
        // A movie whose writer never finished has no index and can't be read.
        let _ = std::fs::remove_file(dir.join(anlg_annotate_core::VIDEO_FILE));
        let elapsed_ms = self.clock.now_ns().saturating_sub(start.started_host_ns) / 1_000_000;
        Some(StopResult {
            video_path: String::new(),
            started_wall_ms: start.started_wall_ms,
            duration_ms: i64::try_from(elapsed_ms).unwrap_or(i64::MAX),
            video_offset_ms: None,
            display: start.display.clone(),
            front_app: Default::default(),
            candidates,
            strokes: Vec::new(),
            ended_by: "stream_error".into(),
            warnings: vec![format!(
                "The screen recording could not be finished, so this annotation has no video or ink: {error}"
            )],
        })
    }

    /// Writes the stopped recording's bundle, with the transcript when there
    /// is one. A failure keeps the recording for one more try (or `cancel`);
    /// a second one goes back to idle and leaves its folder.
    pub async fn finalize(
        &self,
        id: &str,
        transcript: Option<TranscriptInput>,
    ) -> Result<Finalized, Error> {
        let (dir, result, stopped) = {
            let mut state = self.lock();
            match &mut *state {
                State::Finishing(finishing) if finishing.id == id => match finishing.stop.take() {
                    Some((result, stopped)) => (finishing.dir.clone(), result, stopped),
                    None => return Err(Error::Busy("finishing")),
                },
                _ => return Err(Error::UnknownAnnotation),
            }
        };
        let native = self.native.clone();
        let finalized = {
            let dir = dir.clone();
            let result = result.clone();
            blocking(move || bundle::finalize(&native, &dir, &result, transcript))
                .await
                .and_then(|finalized| finalized)
        };
        let mut state = self.lock();
        let State::Finishing(finishing) = &mut *state else {
            return finalized;
        };
        if finishing.discard {
            *state = State::Idle;
            drop(state);
            let _ = std::fs::remove_dir_all(&dir);
            return Err(Error::Cancelled);
        }
        match finalized {
            Err(error) if !finishing.retried => {
                finishing.retried = true;
                finishing.stop = Some((result, stopped));
                Err(error)
            }
            finalized => {
                *state = State::Idle;
                finalized
            }
        }
    }

    /// Stops and deletes the recording, or the stopped one waiting for
    /// `finalize`. One still starting, being stopped or being finalized is
    /// deleted once that is done. Nothing to cancel is fine.
    pub async fn cancel(&self) -> Result<(), Error> {
        enum Taken {
            Recording(Box<Active>),
            Stopped(PathBuf),
        }
        let taken = {
            let mut state = self.lock();
            match std::mem::replace(&mut *state, State::Idle) {
                State::Idle => return Ok(()),
                State::Starting { .. } => {
                    *state = State::Starting { cancel: true };
                    return Ok(());
                }
                State::Recording(active) => {
                    *state = State::Finishing(Box::new(Finishing::new(
                        active.id.clone(),
                        active.dir.clone(),
                    )));
                    (self.escape)(false);
                    Taken::Recording(active)
                }
                State::Finishing(finishing) if finishing.stop.is_some() => {
                    Taken::Stopped(finishing.dir)
                }
                State::Finishing(mut finishing) => {
                    finishing.discard = true;
                    *state = State::Finishing(finishing);
                    return Ok(());
                }
            }
        };
        match taken {
            Taken::Stopped(dir) => {
                let _ = std::fs::remove_dir_all(dir);
                Ok(())
            }
            Taken::Recording(active) => {
                let Active {
                    dir,
                    narration,
                    poll,
                    ..
                } = *active;
                poll.cancel();
                let native = self.native.clone();
                let (cancelled, ()) =
                    tokio::join!(blocking(move || native.cancel()), narration.cancel());
                let _ = std::fs::remove_dir_all(&dir);
                self.set_idle();
                cancelled?.map_err(Error::from)
            }
        }
    }

    /// The app is quitting: whatever records, starts or finishes is
    /// discarded, the native layer's windows and capture end and the
    /// narration file is closed, within `within`. A folder left behind has
    /// no manifest and goes with retention a day later.
    pub async fn shutdown(&self, within: Duration) {
        let discarded = tokio::time::timeout(within, async {
            loop {
                if matches!(&*self.lock(), State::Idle) {
                    return;
                }
                if let Err(error) = self.cancel().await {
                    tracing::warn!(%error, "annotate shutdown");
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await;
        if discarded.is_err() {
            tracing::warn!("annotate shutdown timed out");
        }
    }

    pub fn set_ink_mode(&self, mode: &str) -> Result<(), Error> {
        let state = self.lock();
        if !matches!(&*state, State::Recording(_)) {
            return Err(Error::NotRecording);
        }
        self.native.set_ink_mode(mode).map_err(Error::from)?;
        (self.escape)(mode != "off");
        Ok(())
    }

    pub fn set_retention(&self, preset: Preset) {
        *self.retention.lock().unwrap_or_else(|e| e.into_inner()) = Some(preset);
    }

    /// Applies the retention preset, unless something records or none was
    /// set yet.
    pub async fn run_retention(&self) {
        let Some(preset) = *self.retention.lock().unwrap_or_else(|e| e.into_inner()) else {
            return;
        };
        if !matches!(&*self.lock(), State::Idle) {
            return;
        }
        let root = self.root.clone();
        let report =
            blocking(move || anlg_annotate_core::retention::run(&root, &preset.policy())).await;
        if let Err(error) = report {
            tracing::warn!(%error, "annotate retention");
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use anlg_annotate_macos::AnnotateError;
    use futures_util::stream;

    use super::*;

    /// The native layer as a script: what `stop` and `start` answer, and the
    /// events the next poll returns.
    #[derive(Default)]
    struct Fake {
        dir: Mutex<Option<PathBuf>>,
        events: Mutex<Vec<String>>,
        fail_start: Mutex<Option<AnnotateError>>,
        fail_stop: Mutex<Option<AnnotateError>>,
        start_delay: Mutex<Option<Duration>>,
        stop_delay: Mutex<Option<Duration>>,
        cancels: AtomicUsize,
        extract: AtomicUsize,
    }

    impl Native for Fake {
        fn probe_screen_recording(&self) -> Result<String, AnnotateError> {
            Ok("granted".into())
        }
        fn request_screen_recording(&self) -> Result<bool, AnnotateError> {
            Ok(true)
        }
        fn open_screen_recording_settings(&self) -> Result<(), AnnotateError> {
            Ok(())
        }
        fn start(&self, request: &str) -> Result<String, AnnotateError> {
            if let Some(delay) = *self.start_delay.lock().unwrap() {
                std::thread::sleep(delay);
            }
            if let Some(error) = self.fail_start.lock().unwrap().take() {
                return Err(error);
            }
            let request: serde_json::Value = serde_json::from_str(request).unwrap();
            assert_eq!(request["labels"]["keep"], "Manter");
            *self.dir.lock().unwrap() = Some(request["dir"].as_str().unwrap().into());
            Ok(
                r#"{"started_host_ticks":1,"started_host_ns":1000000,"started_wall_ms":1,
                "display":{"id":1,"width_pt":1512,"height_pt":982,"scale":2,"width_px":3024,
                "height_px":1964,"video_width":2560,"video_height":1662}}"#
                    .into(),
            )
        }
        fn stop(&self) -> Result<String, AnnotateError> {
            if let Some(delay) = *self.stop_delay.lock().unwrap() {
                std::thread::sleep(delay);
            }
            if let Some(error) = self.fail_stop.lock().unwrap().take() {
                return Err(error);
            }
            let dir = self.dir.lock().unwrap().clone().unwrap();
            Ok(crate::bundle::tests::stop_json(&dir, 4).to_string())
        }
        fn cancel(&self) -> Result<(), AnnotateError> {
            self.cancels.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
        fn set_ink_mode(&self, _mode: &str) -> Result<(), AnnotateError> {
            Ok(())
        }
        fn poll_events(&self) -> Result<String, AnnotateError> {
            let events = std::mem::take(&mut *self.events.lock().unwrap());
            Ok(format!("[{}]", events.join(",")))
        }
        fn extract_frames(&self, request: &str) -> Result<String, AnnotateError> {
            self.extract.fetch_add(1, Ordering::SeqCst);
            let request: serde_json::Value = serde_json::from_str(request).unwrap();
            let dir = PathBuf::from(request["dir"].as_str().unwrap());
            std::fs::create_dir_all(&dir).unwrap();
            let frames: Vec<_> = request["times_ms"]
                .as_array()
                .unwrap()
                .iter()
                .map(|t| {
                    let path = dir.join(format!("frame-{t}.png"));
                    image::RgbaImage::from_pixel(1512, 982, image::Rgba([90, 90, 90, 255]))
                        .save(&path)
                        .unwrap();
                    serde_json::json!({"t_ms": t, "video_ms": t, "actual_ms": t, "path": path})
                })
                .collect();
            Ok(serde_json::json!({ "frames": frames, "failed": [] }).to_string())
        }
    }

    struct Mic;

    impl anlg_audio::AudioProvider for Mic {
        fn open_capture(
            &self,
            _: anlg_audio::CaptureConfig,
        ) -> Result<anlg_audio::CaptureStream, anlg_audio::Error> {
            unreachable!()
        }
        fn open_speaker_capture(
            &self,
            _: u32,
            _: usize,
        ) -> Result<anlg_audio::CaptureStream, anlg_audio::Error> {
            unreachable!()
        }
        fn open_mic_capture(
            &self,
            _: Option<String>,
            _: u32,
            chunk: usize,
        ) -> Result<anlg_audio::CaptureStream, anlg_audio::Error> {
            let frame = anlg_audio::CaptureFrame {
                raw_mic: Arc::from(vec![0.1_f32; chunk]),
                raw_speaker: Arc::from([]),
                aec_mic: None,
            };
            Ok(anlg_audio::CaptureStream::new(stream::unfold(
                frame,
                |frame| async move {
                    tokio::time::sleep(Duration::from_millis(1)).await;
                    Some((Ok(frame.clone()), frame))
                },
            )))
        }
        fn default_device_name(&self) -> String {
            "mic".into()
        }
        fn list_mic_devices(&self) -> Vec<String> {
            Vec::new()
        }
        fn play_silence(&self) -> std::sync::mpsc::Sender<()> {
            std::sync::mpsc::channel().0
        }
        fn play_bytes(&self, _: &'static [u8]) -> std::sync::mpsc::Sender<()> {
            std::sync::mpsc::channel().0
        }
        fn probe_mic(&self, _: Option<String>) -> Result<(), anlg_audio::Error> {
            Ok(())
        }
        fn probe_speaker(&self) -> Result<(), anlg_audio::Error> {
            Ok(())
        }
    }

    struct FixedClock;

    impl Clock for FixedClock {
        fn now_ns(&self) -> u64 {
            1_000_000
        }
    }

    fn session(
        root: &std::path::Path,
    ) -> (Arc<Session>, Arc<Fake>, Arc<Mutex<Vec<AnnotateEvent>>>) {
        let (session, fake, events, _) = session_with_escape(root);
        (session, fake, events)
    }

    #[allow(clippy::type_complexity)]
    fn session_with_escape(
        root: &std::path::Path,
    ) -> (
        Arc<Session>,
        Arc<Fake>,
        Arc<Mutex<Vec<AnnotateEvent>>>,
        Arc<Mutex<Vec<bool>>>,
    ) {
        let fake = Arc::new(Fake::default());
        let events = Arc::new(Mutex::new(Vec::new()));
        let escapes = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let escape = escapes.clone();
        let session = Arc::new(Session::new(
            fake.clone(),
            Arc::new(FixedClock),
            root.to_path_buf(),
            Arc::new(move |event| sink.lock().unwrap().push(event)),
            Arc::new(move |on| escape.lock().unwrap().push(on)),
        ));
        (session, fake, events, escapes)
    }

    async fn until(session: &Session, done: impl Fn(&Status) -> bool) {
        tokio::time::timeout(Duration::from_secs(5), async {
            while !done(&session.status()) {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
    }

    fn labels() -> Option<CapsuleLabels> {
        Some(CapsuleLabels {
            keep: Some("Manter".into()),
            ..CapsuleLabels::default()
        })
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_recording_stops_and_finalizes_into_a_bundle_and_frees_the_session() {
        let root = tempfile::tempdir().unwrap();
        let (session, fake, _) = session(root.path());
        let started = session.start(Arc::new(Mic), None, labels()).await.unwrap();
        assert!(matches!(
            session.start(Arc::new(Mic), None, labels()).await,
            Err(Error::Busy("recording"))
        ));
        tokio::time::sleep(Duration::from_millis(30)).await;
        let stopped = session.stop().await.unwrap();
        assert_eq!(stopped.id, started.id);
        let audio = stopped.audio_path.clone().unwrap();
        let wav = hound::WavReader::open(&audio).unwrap();
        assert_eq!(
            (wav.spec().sample_rate, wav.spec().bits_per_sample),
            (16_000, 16)
        );
        assert_eq!(session.status().phase, Phase::Finishing);
        assert_eq!(session.status().stopped.unwrap().id, started.id);

        let transcript = TranscriptInput {
            provider: Some("deepgram".into()),
            model: None,
            text: "Look at this.".into(),
            words: [(900, " Look"), (1_100, " at"), (1_300, " this.")]
                .into_iter()
                .map(|(t, text)| crate::bundle::WordInput {
                    start_ms: t,
                    end_ms: t + 200,
                    text: text.into(),
                })
                .collect(),
        };
        let done = session
            .finalize(&started.id, Some(transcript))
            .await
            .unwrap();
        assert_eq!(session.status().phase, Phase::Idle);
        assert!(done.summary.contains("Look at this."), "{}", done.summary);
        let dir = PathBuf::from(&done.dir);
        assert!(dir.join(anlg_annotate_core::MANIFEST).is_file());
        assert!(PathBuf::from(&done.contact_sheet).is_file());
        assert!(!dir.join(crate::bundle::CANDIDATES_DIR).exists());
        assert!(!dir.join(".extract").exists());
        assert!(fake.extract.load(Ordering::SeqCst) > 0);
        let annotation = anlg_annotate_core::library::read(&dir).unwrap();
        assert_eq!(
            annotation.audio.as_deref(),
            Some(anlg_annotate_core::AUDIO_FILE)
        );
        assert_eq!(annotation.transcript.words.len(), 3);
        assert!(matches!(
            session.finalize(&started.id, None).await,
            Err(Error::UnknownAnnotation)
        ));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn cancelling_deletes_the_folder_and_a_capped_recording_finalizes_without_a_transcript() {
        let root = tempfile::tempdir().unwrap();
        let (session, fake, events) = session(root.path());
        let started = session.start(Arc::new(Mic), None, labels()).await.unwrap();
        session.cancel().await.unwrap();
        assert!(!PathBuf::from(&started.dir).exists());
        assert_eq!(fake.cancels.load(Ordering::SeqCst), 1);
        assert_eq!(session.status().phase, Phase::Idle);

        // The 20-minute cap: the poll stops it and hands it over.
        let started = session.start(Arc::new(Mic), None, labels()).await.unwrap();
        fake.events
            .lock()
            .unwrap()
            .push(r#"{"type":"stopped","reason":"max_duration"}"#.into());
        tokio::time::timeout(Duration::from_secs(5), async {
            while session.status().phase != Phase::Finishing || session.status().stopped.is_none() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert!(matches!(
            events.lock().unwrap().last(),
            Some(AnnotateEvent::Stopped { stopped }) if stopped.id == started.id
        ));
        assert!(matches!(session.stop().await, Err(Error::NotRecording)));
        // Without a transcript (it failed, or nothing was said) it is still a bundle.
        let done = session.finalize(&started.id, None).await.unwrap();
        let annotation =
            anlg_annotate_core::library::read(std::path::Path::new(&done.dir)).unwrap();
        assert!(annotation.transcript.text.is_empty());
        assert!(!annotation.keyframes.is_empty());
        assert_eq!(session.status().phase, Phase::Idle);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_failed_start_returns_to_idle_and_leaves_no_folder() {
        let root = tempfile::tempdir().unwrap();
        let (session, fake, _) = session(root.path());
        *fake.fail_start.lock().unwrap() = Some(AnnotateError {
            code: "permission".into(),
            message: "denied".into(),
        });
        assert!(matches!(
            session.start(Arc::new(Mic), None, labels()).await,
            Err(Error::Permission)
        ));
        assert_eq!(session.status().phase, Phase::Idle);
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_failed_native_stop_keeps_the_narration_and_frames_and_still_finalizes() {
        let root = tempfile::tempdir().unwrap();
        let (session, fake, _) = session(root.path());
        let started = session.start(Arc::new(Mic), None, labels()).await.unwrap();
        let dir = PathBuf::from(&started.dir);
        crate::bundle::tests::stop_json(&dir, 4);
        tokio::time::sleep(Duration::from_millis(30)).await;
        *fake.fail_stop.lock().unwrap() = Some(AnnotateError {
            code: "recording".into(),
            message: "no movie".into(),
        });
        let stopped = session.stop().await.unwrap();
        assert_eq!(stopped.ended_by, "stream_error");
        assert_eq!(stopped.warnings.len(), 1);
        assert!(stopped.audio_path.is_some());
        assert!(!dir.join(anlg_annotate_core::VIDEO_FILE).exists());
        let done = session.finalize(&started.id, None).await.unwrap();
        let annotation = anlg_annotate_core::library::read(&dir).unwrap();
        assert!(!annotation.keyframes.is_empty());
        assert!(annotation.video.is_none() && annotation.audio.is_some());
        assert!(PathBuf::from(done.contact_sheet).is_file());
        assert_eq!(fake.extract.load(Ordering::SeqCst), 0);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_failed_finalize_is_kept_for_one_retry_then_left_in_its_folder() {
        let root = tempfile::tempdir().unwrap();
        let (session, _, _) = session(root.path());
        let started = session.start(Arc::new(Mic), None, labels()).await.unwrap();
        let stopped = session.stop().await.unwrap();
        // A file where the frames folder goes makes writing the bundle fail.
        let dir = PathBuf::from(&stopped.dir);
        std::fs::write(dir.join(anlg_annotate_core::FRAMES_DIR), b"").unwrap();
        assert!(session.finalize(&started.id, None).await.is_err());
        assert_eq!(session.status().phase, Phase::Finishing);
        assert_eq!(session.status().stopped.unwrap().id, started.id);
        assert!(session.finalize(&started.id, None).await.is_err());
        assert_eq!(session.status().phase, Phase::Idle);
        assert!(dir.join(anlg_annotate_core::AUDIO_FILE).is_file());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_discard_while_stopping_wins_quietly() {
        let root = tempfile::tempdir().unwrap();
        let (session, fake, _) = session(root.path());
        let started = session.start(Arc::new(Mic), None, labels()).await.unwrap();
        *fake.stop_delay.lock().unwrap() = Some(Duration::from_millis(200));
        let stopping = tokio::spawn({
            let session = session.clone();
            async move { session.stop().await }
        });
        until(&session, |status| status.phase == Phase::Finishing).await;
        session.cancel().await.unwrap();
        assert!(matches!(stopping.await.unwrap(), Err(Error::Cancelled)));
        assert_eq!(session.status().phase, Phase::Idle);
        assert!(!PathBuf::from(&started.dir).exists());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_cancel_while_starting_tears_the_new_recording_down() {
        let root = tempfile::tempdir().unwrap();
        let (session, fake, _) = session(root.path());
        *fake.start_delay.lock().unwrap() = Some(Duration::from_millis(200));
        let starting = tokio::spawn({
            let session = session.clone();
            async move { session.start(Arc::new(Mic), None, labels()).await }
        });
        until(&session, |status| status.phase == Phase::Starting).await;
        session.cancel().await.unwrap();
        assert!(matches!(starting.await.unwrap(), Err(Error::Cancelled)));
        assert_eq!(session.status().phase, Phase::Idle);
        assert_eq!(fake.cancels.load(Ordering::SeqCst), 1);
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn quitting_discards_a_recording_or_one_waiting_to_be_finished() {
        let root = tempfile::tempdir().unwrap();
        let (session, fake, _) = session(root.path());
        let started = session.start(Arc::new(Mic), None, labels()).await.unwrap();
        session.shutdown(Duration::from_secs(5)).await;
        assert_eq!(session.status().phase, Phase::Idle);
        assert_eq!(fake.cancels.load(Ordering::SeqCst), 1);
        assert!(!PathBuf::from(&started.dir).exists());

        let started = session.start(Arc::new(Mic), None, labels()).await.unwrap();
        session.stop().await.unwrap();
        session.shutdown(Duration::from_secs(5)).await;
        assert_eq!(session.status().phase, Phase::Idle);
        assert!(!PathBuf::from(&started.dir).exists());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn escape_follows_the_ink_and_is_always_given_back_when_recording_ends() {
        let root = tempfile::tempdir().unwrap();
        let (session, fake, _, escapes) = session_with_escape(root.path());
        session.start(Arc::new(Mic), None, labels()).await.unwrap();
        session.set_ink_mode("hover").unwrap();
        assert_eq!(escapes.lock().unwrap().last(), Some(&true));
        // The capsule's pen came on just before the stop.
        fake.events
            .lock()
            .unwrap()
            .push(r#"{"type":"pen_on"}"#.into());
        session.stop().await.unwrap();
        tokio::time::sleep(Duration::from_millis(250)).await;
        assert_eq!(escapes.lock().unwrap().last(), Some(&false));
        assert!(session.set_ink_mode("hover").is_err());
        assert_eq!(escapes.lock().unwrap().last(), Some(&false));
    }

    #[cfg(unix)]
    #[test]
    fn the_annotations_folder_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().join("annotations");
        ensure_root(&root).unwrap();
        let mode = std::fs::metadata(&root).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o700);
    }
}
