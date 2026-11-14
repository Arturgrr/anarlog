//! One capture at a time: idle → selecting → (recording →) finishing →
//! idle. The native layer's blocking calls run on worker threads. While a
//! recording or a card is up, the native events are polled every 100 ms and
//! acted on here, so a recording the capsule or the length limit ended is
//! finished without the frontend asking, and a card's buttons work.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anlg_capture_core::layout::{THUMBNAIL_LONG_EDGE, new_id};
use anlg_capture_core::{Entry, Kind, Layout, Stamp, index, names};

use crate::Error;
use crate::events::{CaptureEvent, CardActionKind};
use crate::native::{
    Event, GifReply, Native, RecordStartReply, RecordStatus, RecordStopReply, ScreenshotReply,
};
use crate::types::{
    CaptureEntry, CaptureLabels, CaptureOutcome, CapturePhase, CaptureStatus, RecordingOutput,
    RecordingRequest, RecordingStart, ScreenshotRequest,
};

const POLL: Duration = Duration::from_millis(100);
/// How long the poll keeps running for a card after it was shown or used. A
/// card leaves by itself after 8 s unless the pointer rests on it; its
/// events wait in the native queue until the poll runs again.
const CARD_WATCH: Duration = Duration::from_secs(120);
const MAX_CARDS: usize = 4;
const MAX_GIF_FRAMES: u32 = 900;
const MAX_RECORDING_S: u32 = 30 * 60;
const JPEG_QUALITY: f64 = 0.9;

pub type Emit = Arc<dyn Fn(CaptureEvent) + Send + Sync>;

struct Recording {
    id: String,
    created_ms: i64,
    stamp: Stamp,
    output: RecordingOutput,
    /// Where the native layer writes the movie: the destination for an
    /// MP4, a hidden file in the library for a GIF.
    movie: PathBuf,
    dest: PathBuf,
    in_library: bool,
    gif_fps: u32,
    gif_max_width: u32,
    copy: bool,
    show_card: bool,
    display_id: Option<u64>,
    scale: f64,
}

enum State {
    Idle,
    /// `cancel` asks a recording's start to undo itself once the native
    /// layer answers.
    Selecting {
        recording: bool,
        cancel: bool,
    },
    Recording(Box<Recording>),
    Finishing,
}

/// What the plugin remembers of a capture made since launch, for its card.
#[derive(Clone, Default)]
pub(crate) struct Meta {
    /// The user's folder the card's Save moves a library capture to.
    pub folder: Option<String>,
    pub display_id: Option<u64>,
}

#[derive(Default)]
pub(crate) struct Cards {
    /// Cards shown, oldest first, with when they were last shown or used.
    up: Vec<(String, Instant)>,
    polling: bool,
    pub labels: CaptureLabels,
    pub meta: HashMap<String, Meta>,
}

pub struct Session {
    pub(crate) native: Arc<dyn Native>,
    pub(crate) layout: Layout,
    pub(crate) downloads: Option<PathBuf>,
    pub(crate) emit: Emit,
    state: Mutex<State>,
    /// Serializes reading and writing the index.
    pub(crate) index: Mutex<()>,
    /// Locked before `state` when both are.
    pub(crate) cards: Mutex<Cards>,
}

pub(crate) async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, Error> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| Error::Task(error.to_string()))
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| {
            i64::try_from(since.as_millis()).unwrap_or(i64::MAX)
        })
}

fn parse<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, Error> {
    serde_json::from_str(json).map_err(|error| Error::Native(error.to_string()))
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Renames `from` to `to`, copying across volumes.
pub(crate) fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    std::fs::copy(from, to)?;
    std::fs::remove_file(from)
}

impl Session {
    pub fn new(
        native: Arc<dyn Native>,
        layout: Layout,
        downloads: Option<PathBuf>,
        emit: Emit,
    ) -> Self {
        Self {
            native,
            layout,
            downloads,
            emit,
            state: Mutex::new(State::Idle),
            index: Mutex::new(()),
            cards: Mutex::new(Cards::default()),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub(crate) fn lock_cards(&self) -> std::sync::MutexGuard<'_, Cards> {
        self.cards.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn set_idle(&self) {
        *self.lock() = State::Idle;
    }

    fn claim(&self, recording: bool) -> Result<(), Error> {
        let mut state = self.lock();
        if !matches!(&*state, State::Idle) {
            return Err(Error::Busy);
        }
        *state = State::Selecting {
            recording,
            cancel: false,
        };
        Ok(())
    }

    pub fn status(&self) -> CaptureStatus {
        let phase = match &*self.lock() {
            State::Idle => CapturePhase::Idle,
            State::Selecting { .. } => CapturePhase::Selecting,
            State::Recording(_) => CapturePhase::Recording,
            State::Finishing => CapturePhase::Finishing,
        };
        let elapsed_ms = if phase == CapturePhase::Recording {
            self.native
                .record_status()
                .ok()
                .and_then(|json| serde_json::from_str::<RecordStatus>(&json).ok())
                .map_or(0, |status| status.elapsed_ms)
        } else {
            0
        };
        CaptureStatus {
            available: cfg!(target_os = "macos"),
            phase,
            elapsed_ms,
        }
    }

    /// The folder a new capture goes to, created when missing.
    fn destination(&self, save_dir: Option<&str>) -> Result<(PathBuf, bool), Error> {
        let (dest, in_library) = self
            .layout
            .destination(save_dir, self.downloads.as_deref())?;
        self.layout.ensure()?;
        if !in_library {
            std::fs::create_dir_all(&dest)?;
        }
        Ok((dest, in_library))
    }

    /// Takes a screenshot through the selector (or of the display under the
    /// pointer) and finishes it as the request asks.
    pub async fn screenshot(
        self: &Arc<Self>,
        request: ScreenshotRequest,
    ) -> Result<CaptureOutcome, Error> {
        self.claim(false)?;
        let taken = self.take_screenshot(request).await;
        self.set_idle();
        taken
    }

    async fn take_screenshot(
        self: &Arc<Self>,
        request: ScreenshotRequest,
    ) -> Result<CaptureOutcome, Error> {
        let created_ms = now_ms();
        let id = new_id(created_ms);
        let (dest, in_library) = self.destination(request.save_dir.as_deref())?;
        let out = names::screenshot_path(&dest, Stamp::local(created_ms), request.format.into());
        let thumbnail = self.layout.thumbnail_path(&id);
        let json = serde_json::json!({
            "mode": request.mode.as_str(),
            "out_path": path_text(&out),
            "format": match request.format {
                crate::types::ImageFormat::Png => "png",
                crate::types::ImageFormat::Jpeg => "jpeg",
            },
            "jpeg_quality": JPEG_QUALITY,
            "thumbnail_path": path_text(&thumbnail),
            "thumbnail_long_edge": THUMBNAIL_LONG_EDGE,
            "show_cursor": request.show_cursor,
            "labels": request.labels.screenshot_json(),
        })
        .to_string();
        let native = self.native.clone();
        let reply: ScreenshotReply = parse(&blocking(move || native.screenshot(&json)).await??)?;
        if reply.status != "captured" {
            return Ok(CaptureOutcome::Cancelled);
        }
        let path = reply.path.map(PathBuf::from).unwrap_or(out);
        let bytes = std::fs::metadata(&path)?.len();
        let thumbnail_path = reply
            .thumbnail_path
            .filter(|path| Path::new(path).is_file())
            .unwrap_or_default();
        let entry = Entry {
            id,
            kind: Kind::Screenshot,
            path: path_text(&path),
            thumbnail_path,
            created_ms,
            width: reply.width_px,
            height: reply.height_px,
            scale: reply.scale,
            duration_ms: 0,
            bytes,
            in_library,
        };
        let meta = Meta {
            folder: request.folder,
            display_id: reply.display_id,
        };
        let entry = self
            .finish(entry, meta, request.copy, request.show_card, request.labels)
            .await?;
        Ok(CaptureOutcome::Captured { entry })
    }

    /// Indexes a new capture, copies it and shows its card as asked, then
    /// tells the frontend.
    async fn finish(
        self: &Arc<Self>,
        entry: Entry,
        meta: Meta,
        copy: bool,
        show_card: bool,
        labels: CaptureLabels,
    ) -> Result<CaptureEntry, Error> {
        {
            let mut cards = self.lock_cards();
            cards.labels = labels;
            if cards.meta.len() > 2 * anlg_capture_core::index::MAX_ENTRIES {
                cards.meta.clear();
            }
            cards.meta.insert(entry.id.clone(), meta);
        }
        let session = self.clone();
        let added = entry.clone();
        blocking(move || session.add_entry(added)).await??;
        if copy {
            let session = self.clone();
            let copied = entry.clone();
            if let Err(error) = blocking(move || session.copy_entry(&copied)).await? {
                (self.emit)(CaptureEvent::Failed {
                    message: error.to_string(),
                });
            }
        }
        if show_card && let Err(error) = self.show_entry_card(&entry) {
            tracing::warn!(%error, "capture card");
        }
        let entry = CaptureEntry::from(entry);
        (self.emit)(CaptureEvent::Captured {
            entry: entry.clone(),
        });
        Ok(entry)
    }

    /// Shows the selector, counts down and starts recording.
    pub async fn start_recording(
        self: &Arc<Self>,
        request: RecordingRequest,
    ) -> Result<RecordingStart, Error> {
        self.claim(true)?;
        let started = self.begin_recording(request).await;
        if !matches!(started, Ok(RecordingStart::Recording { .. })) {
            self.set_idle();
        }
        started
    }

    async fn begin_recording(
        self: &Arc<Self>,
        request: RecordingRequest,
    ) -> Result<RecordingStart, Error> {
        let created_ms = now_ms();
        let id = new_id(created_ms);
        let stamp = Stamp::local(created_ms);
        let (dest, in_library) = self.destination(request.save_dir.as_deref())?;
        let gif = request.output == RecordingOutput::Gif;
        let movie = if gif {
            self.layout.files_dir().join(format!(".recording-{id}.mp4"))
        } else {
            names::recording_path(&dest, stamp, false)
        };
        let json = serde_json::json!({
            "mode": request.mode.as_str(),
            "out_path": path_text(&movie),
            "fps": request.fps.clamp(1, 60),
            "show_cursor": request.show_cursor,
            "microphone": request.microphone,
            "system_audio": request.system_audio,
            "countdown_s": request.countdown_s.min(10),
            "max_duration_s": MAX_RECORDING_S,
            "labels": request.labels.recording_json(),
        })
        .to_string();
        let native = self.native.clone();
        let reply: RecordStartReply = parse(&blocking(move || native.record_start(&json)).await??)?;
        if reply.status != "recording" {
            return Ok(RecordingStart::Cancelled);
        }
        {
            let mut cards = self.lock_cards();
            cards.labels = request.labels;
            cards.meta.insert(
                id.clone(),
                Meta {
                    folder: request.folder,
                    display_id: reply.display_id,
                },
            );
        }
        let recording = Box::new(Recording {
            id,
            created_ms,
            stamp,
            output: request.output,
            movie,
            dest,
            in_library,
            gif_fps: request.gif_fps.clamp(1, 30),
            gif_max_width: request.gif_max_width.max(16),
            copy: request.copy,
            show_card: request.show_card,
            display_id: reply.display_id,
            scale: reply.scale,
        });
        let cancelled = {
            let mut state = self.lock();
            if matches!(&*state, State::Selecting { cancel: true, .. }) {
                Some(recording)
            } else {
                *state = State::Recording(recording);
                None
            }
        };
        if let Some(recording) = cancelled {
            // Quit, or a cancel, while the native layer was starting.
            let native = self.native.clone();
            if let Ok(Err(error)) = blocking(move || native.record_cancel()).await {
                tracing::warn!(%error, "capture cancel after start");
            }
            let _ = std::fs::remove_file(&recording.movie);
            return Ok(RecordingStart::Cancelled);
        }
        self.ensure_poll();
        (self.emit)(CaptureEvent::RecordingStarted {
            output: request.output,
        });
        Ok(RecordingStart::Recording {
            output: request.output,
        })
    }

    fn take_recording(&self) -> Option<Box<Recording>> {
        let mut state = self.lock();
        if !matches!(&*state, State::Recording(_)) {
            return None;
        }
        let State::Recording(recording) = std::mem::replace(&mut *state, State::Finishing) else {
            unreachable!()
        };
        Some(recording)
    }

    /// Ends the recording and finishes it: the movie, or the GIF made from
    /// it, at its destination, indexed, copied and on a card as asked.
    pub async fn stop_recording(self: &Arc<Self>) -> Result<CaptureOutcome, Error> {
        let recording = self.take_recording().ok_or(Error::NotRecording)?;
        self.finish_recording(recording).await
    }

    async fn finish_recording(
        self: &Arc<Self>,
        recording: Box<Recording>,
    ) -> Result<CaptureOutcome, Error> {
        let finished = self.finish_recording_inner(&recording).await;
        if finished.is_err() {
            let _ = std::fs::remove_file(&recording.movie);
        }
        self.set_idle();
        finished.map(|entry| CaptureOutcome::Captured { entry })
    }

    async fn finish_recording_inner(
        self: &Arc<Self>,
        recording: &Recording,
    ) -> Result<CaptureEntry, Error> {
        let native = self.native.clone();
        let stop: RecordStopReply = parse(&blocking(move || native.record_stop()).await??)?;
        for warning in &stop.warnings {
            tracing::warn!(%warning, ended_by = %stop.ended_by, "capture recording");
        }
        let movie = if stop.video_path.is_empty() {
            recording.movie.clone()
        } else {
            PathBuf::from(&stop.video_path)
        };
        let (mut path, mut kind, mut width, mut height) =
            (movie.clone(), Kind::Video, stop.width_px, stop.height_px);
        if recording.output == RecordingOutput::Gif {
            let out = names::recording_path(&recording.dest, recording.stamp, true);
            let json = serde_json::json!({
                "video": path_text(&movie),
                "out_path": path_text(&out),
                "fps": recording.gif_fps,
                "max_width": recording.gif_max_width,
                "max_frames": MAX_GIF_FRAMES,
            })
            .to_string();
            let native = self.native.clone();
            let made = blocking(move || native.make_gif(&json))
                .await?
                .map_err(Error::from)
                .and_then(|reply| parse::<GifReply>(&reply));
            match made {
                Ok(gif) => {
                    let _ = std::fs::remove_file(&movie);
                    (path, kind, width, height) = (
                        PathBuf::from(gif.path),
                        Kind::Gif,
                        gif.width_px,
                        gif.height_px,
                    );
                }
                Err(error) => {
                    // The recording is worth more than the GIF: keep it as a movie.
                    let kept = names::recording_path(&recording.dest, recording.stamp, false);
                    move_file(&movie, &kept)?;
                    path = kept;
                    (self.emit)(CaptureEvent::Failed {
                        message: format!(
                            "Could not make the GIF, so the recording was kept as a movie: {error}"
                        ),
                    });
                }
            }
        }
        let thumbnail = self.layout.thumbnail_path(&recording.id);
        let json = serde_json::json!({
            "source": path_text(&path),
            "out_path": path_text(&thumbnail),
            "long_edge": THUMBNAIL_LONG_EDGE,
        })
        .to_string();
        let native = self.native.clone();
        let thumbnail_path = match blocking(move || native.thumbnail(&json)).await? {
            Ok(_) if thumbnail.is_file() => path_text(&thumbnail),
            Ok(_) => String::new(),
            Err(error) => {
                tracing::warn!(%error, "capture thumbnail");
                String::new()
            }
        };
        let entry = Entry {
            id: recording.id.clone(),
            kind,
            bytes: std::fs::metadata(&path)?.len(),
            path: path_text(&path),
            thumbnail_path,
            created_ms: recording.created_ms,
            width,
            height,
            scale: recording.scale,
            duration_ms: stop.duration_ms,
            in_library: recording.in_library,
        };
        let (meta, labels) = {
            let cards = self.lock_cards();
            let meta = cards.meta.get(&recording.id).cloned().unwrap_or(Meta {
                folder: None,
                display_id: recording.display_id,
            });
            (meta, cards.labels.clone())
        };
        self.finish(entry, meta, recording.copy, recording.show_card, labels)
            .await
    }

    /// Ends the recording, or the selector or countdown before it, and
    /// deletes the movie. Nothing to cancel is fine; a recording being
    /// finished is left to finish.
    pub async fn cancel_recording(&self) -> Result<(), Error> {
        let recording = {
            let mut state = self.lock();
            match std::mem::replace(&mut *state, State::Idle) {
                State::Idle => return Ok(()),
                State::Finishing => {
                    *state = State::Finishing;
                    return Ok(());
                }
                State::Selecting { recording, .. } => {
                    *state = State::Selecting {
                        recording,
                        cancel: true,
                    };
                    None
                }
                State::Recording(recording) => {
                    *state = State::Finishing;
                    Some(recording)
                }
            }
        };
        let native = self.native.clone();
        let cancelled = blocking(move || native.record_cancel()).await?;
        let Some(recording) = recording else {
            // The selector answers `cancelled` to whoever waits on it.
            return Ok(());
        };
        let _ = std::fs::remove_file(&recording.movie);
        self.set_idle();
        cancelled.map_err(Error::from)
    }

    /// The app is quitting: the cards close and whatever selects or records
    /// is cancelled, within `within`.
    pub async fn shutdown(&self, within: Duration) {
        let _ = self.close_cards();
        let done = tokio::time::timeout(within, async {
            loop {
                if matches!(&*self.lock(), State::Idle) {
                    return;
                }
                if let Err(error) = self.cancel_recording().await {
                    tracing::warn!(%error, "capture shutdown");
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await;
        if done.is_err() {
            tracing::warn!("capture shutdown timed out");
        }
    }

    pub(crate) fn show_entry_card(self: &Arc<Self>, entry: &Entry) -> Result<(), Error> {
        let (display_id, labels) = {
            let cards = self.lock_cards();
            (
                cards.meta.get(&entry.id).and_then(|meta| meta.display_id),
                cards.labels.card_json(),
            )
        };
        let json = serde_json::json!({
            "id": entry.id,
            "kind": entry.kind.as_str(),
            "path": entry.path,
            "thumbnail_path": entry.thumbnail_path,
            "display_id": display_id,
            "duration_ms": entry.duration_ms,
            "saved": !entry.in_library,
            "labels": labels,
        })
        .to_string();
        self.native.card_show(&json)?;
        {
            let mut cards = self.lock_cards();
            cards.up.retain(|(id, _)| *id != entry.id);
            cards.up.push((entry.id.clone(), Instant::now()));
            let extra = cards.up.len().saturating_sub(MAX_CARDS);
            cards.up.drain(..extra);
        }
        self.ensure_poll();
        Ok(())
    }

    pub(crate) fn close_card(&self, id: &str) {
        self.lock_cards().up.retain(|(up, _)| up != id);
        if let Err(error) = self
            .native
            .card_close(&serde_json::json!({ "id": id }).to_string())
        {
            tracing::debug!(%error, "capture card close");
        }
    }

    pub fn close_cards(&self) -> Result<(), Error> {
        self.lock_cards().up.clear();
        self.native
            .card_close(&serde_json::json!({ "all": true }).to_string())
            .map_err(Error::from)
    }

    fn touch_card(&self, id: &str) {
        if let Some((_, at)) = self.lock_cards().up.iter_mut().find(|(up, _)| up == id) {
            *at = Instant::now();
        }
    }

    fn ensure_poll(self: &Arc<Self>) {
        {
            let mut cards = self.lock_cards();
            if cards.polling {
                return;
            }
            cards.polling = true;
        }
        let session = self.clone();
        tauri::async_runtime::spawn(async move { session.poll().await });
    }

    /// Whether anything needs the poll; stops it (under the cards' lock, so
    /// [`Session::ensure_poll`] starts a new one) when nothing does.
    fn keep_polling(&self) -> bool {
        let mut cards = self.lock_cards();
        cards.up.retain(|(_, at)| at.elapsed() < CARD_WATCH);
        let recording = matches!(
            &*self.lock(),
            State::Recording(_)
                | State::Selecting {
                    recording: true,
                    ..
                }
        );
        let keep = recording || !cards.up.is_empty();
        if !keep {
            cards.polling = false;
        }
        keep
    }

    async fn poll(self: Arc<Self>) {
        loop {
            tokio::time::sleep(POLL).await;
            if !self.keep_polling() {
                return;
            }
            let events = match self.native.poll_events() {
                Ok(json) => serde_json::from_str::<Vec<Event>>(&json).unwrap_or_default(),
                Err(error) => {
                    tracing::warn!(%error, "capture events");
                    continue;
                }
            };
            for event in events {
                self.handle(event);
            }
        }
    }

    fn handle(self: &Arc<Self>, event: Event) {
        match event.kind.as_str() {
            "record_stop" | "record_stopped" => {
                let reason = event.reason.unwrap_or_else(|| "stop".into());
                let session = self.clone();
                tauri::async_runtime::spawn(async move { session.stopped(reason).await });
            }
            "record_discard" => {
                let session = self.clone();
                tauri::async_runtime::spawn(async move { session.discarded().await });
            }
            "card_action" => {
                let (Some(id), Some(action)) = (event.id, event.action) else {
                    return;
                };
                self.touch_card(&id);
                let session = self.clone();
                tauri::async_runtime::spawn(async move { session.card_action(id, action).await });
            }
            _ => {}
        }
    }

    /// The capsule's stop, or the recording ended by itself: finish it here.
    async fn stopped(self: Arc<Self>, reason: String) {
        // The frontend's stop got there first otherwise.
        let Some(recording) = self.take_recording() else {
            return;
        };
        (self.emit)(CaptureEvent::RecordingStopped { reason });
        if let Err(error) = self.finish_recording(recording).await {
            (self.emit)(CaptureEvent::Failed {
                message: error.to_string(),
            });
        }
    }

    async fn discarded(self: Arc<Self>) {
        if !matches!(&*self.lock(), State::Recording(_)) {
            return;
        }
        match self.cancel_recording().await {
            Ok(()) => (self.emit)(CaptureEvent::RecordingStopped {
                reason: "discarded".into(),
            }),
            Err(error) => (self.emit)(CaptureEvent::Failed {
                message: error.to_string(),
            }),
        }
    }

    async fn card_action(self: Arc<Self>, id: String, action: String) {
        let forwarded = match action.as_str() {
            "edit" => Some(CardActionKind::Edit),
            "open" => Some(CardActionKind::Open),
            _ => None,
        };
        if let Some(action) = forwarded {
            (self.emit)(CaptureEvent::CardAction { id, action });
            return;
        }
        let done = match action.as_str() {
            "copy" => {
                let session = self.clone();
                blocking(move || session.copy_capture(&id))
                    .await
                    .and_then(|copied| copied)
            }
            "save" => {
                let session = self.clone();
                blocking(move || session.card_save(&id))
                    .await
                    .and_then(|saved| saved)
            }
            "close" => {
                self.close_card(&id);
                Ok(())
            }
            // The file went where it was dropped; nothing to do.
            _ => Ok(()),
        };
        if let Err(error) = done {
            (self.emit)(CaptureEvent::Failed {
                message: error.to_string(),
            });
        }
    }

    pub(crate) fn forget(&self, dropped: &[Entry]) {
        index::forget(&self.layout, dropped);
    }
}
