//! One capture at a time: idle → selecting → (recording →) finishing →
//! idle. The native layer's blocking calls run on worker threads. While a
//! recording or a card is up, the native events are polled every 100 ms and
//! acted on here, so a recording the capsule or the length limit ended is
//! finished without the frontend asking, and a card's buttons work.
//!
//! The native layer writes every capture into a hidden file in the library;
//! it gets its name (the moment it was taken) and moves to its destination
//! once it exists. From the moment a recording stopped, its movie is never
//! deleted: when a later step fails it is kept where it is and reported.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anlg_capture_core::fs::{ensure_writable, move_to_free_name};
use anlg_capture_core::layout::{THUMBNAIL_LONG_EDGE, new_id};
use anlg_capture_core::names::FileName;
use anlg_capture_core::{Entry, Kind, Layout, Stamp, index};

use crate::Error;
use crate::events::{CaptureEvent, CardActionKind};
use crate::native::{
    Event, GifReply, Native, RecordStartReply, RecordStatus, RecordStopReply, ScreenshotReply,
};
use crate::types::{
    CaptureEntry, CaptureLabels, CaptureOutcome, CapturePhase, CaptureStatus, ImageFormat,
    RecordingOutput, RecordingRequest, RecordingStart, ScreenshotRequest,
};

const POLL: Duration = Duration::from_millis(100);
/// A card leaves by itself (the native layer then posts `card_closed`); this
/// only stops the poll for a card whose `card_closed` never came.
const CARD_SAFETY_CAP: Duration = Duration::from_secs(10 * 60);
const MAX_GIF_FRAMES: u32 = 900;
const MAX_RECORDING_S: u32 = 30 * 60;
const JPEG_QUALITY: f64 = 0.9;
/// Hidden files older than this in the library were left by a quit or a
/// crash: a recording is capped at 30 minutes.
const STALE_TEMPS: Duration = Duration::from_secs(2 * 60 * 60);
/// The least quitting waits for a running recording to stop: it is never
/// cancelled instead, since it has frames.
const QUIT_STOP_AT_LEAST: Duration = Duration::from_secs(2);
/// Card metadata kept for captures made since launch.
const MAX_META: usize = 2 * anlg_capture_core::index::MAX_ENTRIES;

pub type Emit = Arc<dyn Fn(CaptureEvent) + Send + Sync>;

struct Recording {
    output: RecordingOutput,
    /// The hidden file in the library the native layer writes the movie to.
    movie: PathBuf,
    dest: PathBuf,
    in_library: bool,
    /// When frames started being written: the capture's time and name.
    created_ms: i64,
    id: String,
    gif_fps: u32,
    gif_max_width: u32,
    copy: bool,
    show_card: bool,
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

/// How a stopped recording is finished.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Finish {
    /// As its request asked.
    Normal,
    /// The app is quitting: kept as a movie, indexed, nothing else.
    Quit,
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
    /// Cards up, oldest first, with when each was shown.
    up: Vec<(String, Instant)>,
    /// `card_closed` events still to come for cards this plugin closed.
    closing: HashMap<String, u32>,
    polling: bool,
    pub labels: CaptureLabels,
    meta: HashMap<String, (u64, Meta)>,
    next: u64,
}

impl Cards {
    pub fn is_up(&self, id: &str) -> bool {
        self.up.iter().any(|(up, _)| up == id)
    }

    pub fn meta(&self, id: &str) -> Option<&Meta> {
        self.meta.get(id).map(|(_, meta)| meta)
    }

    /// Remembers `meta` for `id`; past [`MAX_META`] the oldest go, never
    /// one whose card is up.
    pub fn remember(&mut self, id: String, meta: Meta) {
        self.next += 1;
        self.meta.insert(id, (self.next, meta));
        if self.meta.len() <= MAX_META {
            return;
        }
        let mut old: Vec<(u64, String)> = self
            .meta
            .iter()
            .filter(|(id, _)| !self.is_up(id))
            .map(|(id, (seq, _))| (*seq, id.clone()))
            .collect();
        old.sort_unstable();
        let extra = self.meta.len() - MAX_META;
        for (_, id) in old.into_iter().take(extra) {
            self.meta.remove(&id);
        }
    }

    fn closed(&mut self, id: &str) {
        if let Some(count) = self.closing.get_mut(id) {
            *count -= 1;
            if *count == 0 {
                self.closing.remove(id);
            }
            return;
        }
        self.up.retain(|(up, _)| up != id);
    }
}

pub struct Session {
    pub(crate) native: Arc<dyn Native>,
    pub(crate) layout: Layout,
    pub(crate) downloads: Option<PathBuf>,
    pub(crate) emit: Emit,
    state: Mutex<State>,
    /// A GIF being written, removed when quitting cannot wait for it.
    partial: Mutex<Option<PathBuf>>,
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
            partial: Mutex::new(None),
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

    fn set_partial(&self, partial: Option<PathBuf>) {
        *self.partial.lock().unwrap_or_else(|e| e.into_inner()) = partial;
    }

    fn set_idle(&self) {
        *self.lock() = State::Idle;
    }

    fn claim(&self, recording: bool) -> Result<(), Error> {
        if !self.native.available() {
            return Err(Error::Unavailable);
        }
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
            available: self.native.available(),
            phase,
            elapsed_ms,
        }
    }

    /// The folder a new capture goes to, created when missing and proved
    /// writable before any selector shows.
    fn destination(&self, save_dir: Option<&str>) -> Result<(PathBuf, bool), Error> {
        let (dest, in_library) = self
            .layout
            .destination(save_dir, self.downloads.as_deref())?;
        self.layout.ensure()?;
        ensure_writable(&dest).map_err(|error| Error::NotWritable(path_text(&dest), error))?;
        Ok((dest, in_library))
    }

    /// Moves a finished capture from its hidden file into `dest` under
    /// `name`, never replacing a file. When that fails it stays in the
    /// library, under that name if it can; the message says where. Blocks.
    fn place(
        &self,
        source: &Path,
        dest: &Path,
        in_library: bool,
        name: FileName,
    ) -> (PathBuf, bool, Option<String>) {
        let error = match move_to_free_name(source, dest, |copy| name.nth(copy)) {
            Ok(moved) => {
                if let Some(leftover) = moved.leftover {
                    // Saved all the same; only the hidden copy stays behind.
                    tracing::warn!(%leftover, source = %source.display(), "capture leftover");
                }
                return (moved.path, in_library, None);
            }
            Err(error) => error,
        };
        let files = self.layout.files_dir();
        let kept = (dest != files)
            .then(|| move_to_free_name(source, &files, |copy| name.nth(copy)).ok())
            .flatten()
            .map_or_else(|| source.to_path_buf(), |moved| moved.path);
        let message = format!(
            "Could not save the capture in {}: {error}. It was kept at {}.",
            dest.display(),
            kept.display()
        );
        (kept, true, Some(message))
    }

    /// [`Session::place`] on the blocking pool: a move across volumes copies.
    async fn place_off_thread(
        self: &Arc<Self>,
        source: PathBuf,
        dest: PathBuf,
        in_library: bool,
        name: FileName,
    ) -> Result<(PathBuf, bool, Option<String>), Error> {
        let session = self.clone();
        blocking(move || session.place(&source, &dest, in_library, name)).await
    }

    /// Gives movies a quit or crash left hidden in the library a visible
    /// "(recovered)" name and an index entry; the other leftovers go. Run at
    /// launch, on a worker.
    pub fn recover_leftovers(&self) -> Vec<CaptureEntry> {
        if !self.native.available() {
            return Vec::new();
        }
        let mut recovered = Vec::new();
        let movies = self.layout.sweep_temps(STALE_TEMPS);
        if !movies.is_empty()
            && let Err(error) = self.layout.ensure()
        {
            tracing::warn!(%error, "capture recovery");
            return recovered;
        }
        for movie in movies {
            let created_ms = std::fs::metadata(&movie)
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or_else(now_ms, |since| {
                    i64::try_from(since.as_millis()).unwrap_or(i64::MAX)
                });
            let name = FileName::recovered(Stamp::local(created_ms));
            let moved =
                match move_to_free_name(&movie, &self.layout.files_dir(), |copy| name.nth(copy)) {
                    Ok(moved) => moved,
                    Err(error) => {
                        tracing::warn!(%error, movie = %movie.display(), "capture recovery");
                        continue;
                    }
                };
            let id = new_id(created_ms);
            let thumbnail = self.layout.thumbnail_path(&id);
            let json = serde_json::json!({
                "source": path_text(&moved.path),
                "out_path": path_text(&thumbnail),
                "long_edge": THUMBNAIL_LONG_EDGE,
            });
            let thumbnail_path = match self.native.thumbnail(&json.to_string()) {
                Ok(_) if thumbnail.is_file() => path_text(&thumbnail),
                _ => String::new(),
            };
            let entry = Entry {
                id,
                kind: Kind::Video,
                bytes: std::fs::metadata(&moved.path).map_or(0, |metadata| metadata.len()),
                path: path_text(&moved.path),
                thumbnail_path,
                created_ms,
                width: 0,
                height: 0,
                scale: 0.0,
                duration_ms: 0,
                in_library: true,
                extra: Default::default(),
            };
            match self.add_entry(entry.clone()) {
                Ok(()) => recovered.push(entry.into()),
                Err(error) => tracing::warn!(%error, "capture recovery"),
            }
        }
        if !recovered.is_empty() {
            tracing::info!(count = recovered.len(), "capture recovered movies");
        }
        recovered
    }

    fn failed(&self, message: String) {
        tracing::warn!(%message, "capture");
        (self.emit)(CaptureEvent::Failed { message });
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
        let (dest, in_library) = self.destination(request.save_dir.as_deref())?;
        let format: anlg_capture_core::ImageFormat = request.format.into();
        let temp = self.layout.temp_path(format.extension());
        let temp_thumbnail = self.layout.temp_path("png");
        let json = serde_json::json!({
            "mode": request.mode.as_str(),
            "out_path": path_text(&temp),
            "format": match request.format {
                ImageFormat::Png => "png",
                ImageFormat::Jpeg => "jpeg",
            },
            "jpeg_quality": JPEG_QUALITY,
            "thumbnail_path": path_text(&temp_thumbnail),
            "thumbnail_long_edge": THUMBNAIL_LONG_EDGE,
            "show_cursor": request.show_cursor,
            "labels": request.labels.screenshot_json(),
        })
        .to_string();
        let native = self.native.clone();
        let taken = blocking(move || native.screenshot(&json))
            .await
            .and_then(|reply| reply.map_err(Error::from))
            .and_then(|reply| parse::<ScreenshotReply>(&reply));
        let reply = match taken {
            Ok(reply) if reply.status == "captured" => reply,
            other => {
                let _ = std::fs::remove_file(&temp);
                let _ = std::fs::remove_file(&temp_thumbnail);
                return other.map(|_| CaptureOutcome::Cancelled);
            }
        };
        *self.lock() = State::Finishing;
        let created_ms = now_ms();
        let id = new_id(created_ms);
        let stamp = Stamp::local(created_ms);
        let source = reply.path.map(PathBuf::from).unwrap_or(temp);
        let (path, in_library, problem) = self
            .place_off_thread(
                source,
                dest,
                in_library,
                FileName::screenshot(stamp, format),
            )
            .await?;
        if let Some(problem) = problem {
            self.failed(problem);
        }
        let source_thumbnail = reply
            .thumbnail_path
            .map(PathBuf::from)
            .unwrap_or(temp_thumbnail);
        let thumbnail = self.layout.thumbnail_path(&id);
        let thumbnail_path = if std::fs::rename(&source_thumbnail, &thumbnail).is_ok() {
            path_text(&thumbnail)
        } else {
            let _ = std::fs::remove_file(&source_thumbnail);
            String::new()
        };
        let entry = Entry {
            id,
            kind: Kind::Screenshot,
            bytes: std::fs::metadata(&path).map_or(0, |metadata| metadata.len()),
            path: path_text(&path),
            thumbnail_path,
            created_ms,
            width: reply.width_px,
            height: reply.height_px,
            scale: reply.scale,
            duration_ms: 0,
            in_library,
            extra: Default::default(),
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
            cards.remember(entry.id.clone(), meta);
        }
        let session = self.clone();
        let added = entry.clone();
        blocking(move || session.add_entry(added))
            .await?
            .map_err(|error| Error::Kept(entry.path.clone(), error.to_string()))?;
        if copy {
            let session = self.clone();
            let copied = entry.clone();
            if let Err(error) = blocking(move || session.copy_entry(&copied)).await? {
                self.failed(error.to_string());
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
        let (dest, in_library) = self.destination(request.save_dir.as_deref())?;
        let movie = self.layout.temp_path("mp4");
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
            let _ = std::fs::remove_file(&movie);
            return Ok(RecordingStart::Cancelled);
        }
        let created_ms = now_ms();
        let id = new_id(created_ms);
        {
            let mut cards = self.lock_cards();
            cards.labels = request.labels;
            cards.remember(
                id.clone(),
                Meta {
                    folder: request.folder,
                    display_id: reply.display_id,
                },
            );
        }
        let recording = Box::new(Recording {
            output: request.output,
            movie,
            dest,
            in_library,
            created_ms,
            id,
            gif_fps: request.gif_fps.clamp(1, 30),
            gif_max_width: request.gif_max_width.max(16),
            copy: request.copy,
            show_card: request.show_card,
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
            // A cancel while the native layer was starting.
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
    /// it, at its destination, indexed, copied and on a card as asked. While
    /// the selector or countdown is still up, cancels it instead.
    pub async fn stop_recording(self: &Arc<Self>) -> Result<CaptureOutcome, Error> {
        if let Some(recording) = self.take_recording() {
            return self.finish_recording(recording, Finish::Normal).await;
        }
        if matches!(
            &*self.lock(),
            State::Selecting {
                recording: true,
                ..
            }
        ) {
            self.cancel_recording().await?;
            return Ok(CaptureOutcome::Cancelled);
        }
        Err(Error::NotRecording)
    }

    async fn finish_recording(
        self: &Arc<Self>,
        recording: Box<Recording>,
        how: Finish,
    ) -> Result<CaptureOutcome, Error> {
        let finished = self.finish_recording_inner(&recording, how).await;
        self.set_partial(None);
        self.set_idle();
        finished.map(|entry| CaptureOutcome::Captured { entry })
    }

    async fn finish_recording_inner(
        self: &Arc<Self>,
        recording: &Recording,
        how: Finish,
    ) -> Result<CaptureEntry, Error> {
        let native = self.native.clone();
        let stopped = blocking(move || native.record_stop()).await?;
        let stop = match stopped {
            Ok(reply) => serde_json::from_str::<RecordStopReply>(&reply).unwrap_or_else(|error| {
                tracing::warn!(%error, "capture stop reply");
                RecordStopReply::default()
            }),
            Err(error) => {
                // The native side may still be finishing a movie with frames
                // in it: that one stays, hidden, for recovery at a later
                // launch. Only an empty or missing one goes.
                let kept =
                    std::fs::metadata(&recording.movie).is_ok_and(|metadata| metadata.len() > 0);
                if !kept {
                    let _ = std::fs::remove_file(&recording.movie);
                    return Err(error.into());
                }
                let error = Error::Unfinished(path_text(&recording.movie), error.to_string());
                self.failed(error.to_string());
                return Err(error);
            }
        };
        for warning in &stop.warnings {
            tracing::warn!(%warning, ended_by = %stop.ended_by, "capture recording");
        }
        // From here on the movie is the user's: kept whatever fails.
        let movie = stop
            .video_path
            .clone()
            .map(PathBuf::from)
            .filter(|path| path.is_file())
            .unwrap_or_else(|| recording.movie.clone());
        let stamp = Stamp::local(recording.created_ms);
        let movie_name = FileName::recording(stamp, false);
        let mut kind = Kind::Video;
        let (mut width, mut height) = (stop.width_px, stop.height_px);
        let gif = recording.output == RecordingOutput::Gif && how == Finish::Normal;
        let (path, in_library, problem) = if gif {
            let out = self.layout.temp_path("gif");
            self.set_partial(Some(out.clone()));
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
                .await
                .and_then(|reply| reply.map_err(Error::from))
                .and_then(|reply| parse::<GifReply>(&reply));
            self.set_partial(None);
            match made {
                Ok(made) => {
                    let source = made
                        .path
                        .filter(|path| !path.is_empty())
                        .map_or(out, PathBuf::from);
                    let placed = self
                        .place_off_thread(
                            source,
                            recording.dest.clone(),
                            recording.in_library,
                            FileName::recording(stamp, true),
                        )
                        .await?;
                    // The movie goes only once its GIF is there.
                    if placed.0.is_file() {
                        let _ = std::fs::remove_file(&movie);
                    }
                    kind = Kind::Gif;
                    (width, height) = (made.width_px, made.height_px);
                    placed
                }
                Err(error) => {
                    let _ = std::fs::remove_file(&out);
                    let (path, in_library, problem) = self
                        .place_off_thread(
                            movie.clone(),
                            recording.dest.clone(),
                            recording.in_library,
                            movie_name,
                        )
                        .await?;
                    let problem = problem.unwrap_or_else(|| {
                        format!(
                            "Could not make the GIF, so the recording was kept as a movie at {}: {error}",
                            path.display()
                        )
                    });
                    (path, in_library, Some(problem))
                }
            }
        } else {
            self.place_off_thread(
                movie.clone(),
                recording.dest.clone(),
                recording.in_library,
                movie_name,
            )
            .await?
        };
        if let Some(problem) = problem {
            self.failed(problem);
        }
        let thumbnail = self.layout.thumbnail_path(&recording.id);
        let thumbnail_path = if how == Finish::Normal {
            let json = serde_json::json!({
                "source": path_text(&path),
                "out_path": path_text(&thumbnail),
                "long_edge": THUMBNAIL_LONG_EDGE,
            })
            .to_string();
            let native = self.native.clone();
            match blocking(move || native.thumbnail(&json)).await? {
                Ok(_) if thumbnail.is_file() => path_text(&thumbnail),
                Ok(_) => String::new(),
                Err(error) => {
                    tracing::warn!(%error, "capture thumbnail");
                    String::new()
                }
            }
        } else {
            String::new()
        };
        let entry = Entry {
            id: recording.id.clone(),
            kind,
            bytes: std::fs::metadata(&path).map_or(0, |metadata| metadata.len()),
            path: path_text(&path),
            thumbnail_path,
            created_ms: recording.created_ms,
            width,
            height,
            scale: recording.scale,
            duration_ms: stop.duration_ms,
            in_library,
            extra: Default::default(),
        };
        let (meta, labels) = {
            let cards = self.lock_cards();
            (
                cards.meta(&recording.id).cloned().unwrap_or_default(),
                cards.labels.clone(),
            )
        };
        let (copy, show_card) = match how {
            Finish::Normal => (recording.copy, recording.show_card),
            Finish::Quit => (false, false),
        };
        let finished = self.finish(entry, meta, copy, show_card, labels).await;
        if let Err(error) = &finished {
            self.failed(error.to_string());
        }
        finished
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
        let cancelled = match blocking(move || native.record_cancel()).await {
            Ok(cancelled) => cancelled,
            Err(error) => {
                if recording.is_some() {
                    self.set_idle();
                }
                return Err(error);
            }
        };
        let Some(recording) = recording else {
            // The selector answers `cancelled` to whoever waits on it.
            return Ok(());
        };
        let _ = std::fs::remove_file(&recording.movie);
        self.set_idle();
        cancelled.map_err(Error::from)
    }

    /// The app is quitting, and allows `within`. The cards close; a
    /// recording is stopped and kept (as a movie, indexed), waiting at least
    /// [`QUIT_STOP_AT_LEAST`]; a selector or countdown is cancelled. Once a
    /// recording was asked to stop it is never cancelled: a finish still
    /// running when time is up leaves its movie hidden in the library, where
    /// a later launch recovers it. Only a GIF still being written goes.
    pub async fn shutdown(self: &Arc<Self>, within: Duration) {
        let _ = self.close_cards();
        let deadline = Instant::now() + within;
        loop {
            if let Some(recording) = self.take_recording() {
                let stop_within = deadline
                    .saturating_duration_since(Instant::now())
                    .max(QUIT_STOP_AT_LEAST);
                let kept = tokio::time::timeout(
                    stop_within,
                    self.finish_recording(recording, Finish::Quit),
                )
                .await;
                match kept {
                    Ok(Ok(_)) => continue,
                    Ok(Err(error)) => tracing::warn!(%error, "capture shutdown"),
                    Err(_) => tracing::warn!(
                        "capture shutdown: the recording is still being finished; it will be recovered"
                    ),
                }
                break;
            }
            if matches!(&*self.lock(), State::Idle) {
                return;
            }
            if Instant::now() >= deadline {
                break;
            }
            // Cancels a selector or countdown; a capture being finished is
            // waited for.
            if let Err(error) = self.cancel_recording().await {
                tracing::warn!(%error, "capture shutdown");
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let partial = self
            .partial
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some(partial) = partial {
            let _ = std::fs::remove_file(partial);
        }
    }

    pub(crate) fn show_entry_card(self: &Arc<Self>, entry: &Entry) -> Result<(), Error> {
        let (display_id, labels) = {
            let cards = self.lock_cards();
            (
                cards.meta(&entry.id).and_then(|meta| meta.display_id),
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
            // The native layer lets cards go (four a display) and says so
            // with `card_closed`.
            cards.up.push((entry.id.clone(), Instant::now()));
        }
        self.ensure_poll();
        Ok(())
    }

    pub(crate) fn close_card(&self, id: &str) {
        {
            let mut cards = self.lock_cards();
            if cards.is_up(id) {
                cards.up.retain(|(up, _)| up != id);
                *cards.closing.entry(id.to_owned()).or_default() += 1;
            }
        }
        if let Err(error) = self
            .native
            .card_close(&serde_json::json!({ "id": id }).to_string())
        {
            tracing::debug!(%error, "capture card close");
        }
    }

    pub fn close_cards(&self) -> Result<(), Error> {
        {
            let mut cards = self.lock_cards();
            cards.up.clear();
            cards.closing.clear();
        }
        self.native
            .card_close(&serde_json::json!({ "all": true }).to_string())
            .map_err(Error::from)
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
        cards
            .up
            .retain(|(_, shown)| shown.elapsed() < CARD_SAFETY_CAP);
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
                Ok(json) => match serde_json::from_str::<Vec<serde_json::Value>>(&json) {
                    Ok(events) => events,
                    Err(error) => {
                        tracing::warn!(%error, "capture events");
                        continue;
                    }
                },
                Err(error) => {
                    tracing::warn!(%error, "capture events");
                    continue;
                }
            };
            for event in events {
                match serde_json::from_value::<Event>(event) {
                    Ok(event) => self.handle(event),
                    Err(error) => tracing::warn!(%error, "capture event skipped"),
                }
            }
        }
    }

    pub(crate) fn handle(self: &Arc<Self>, event: Event) {
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
            "card_closed" => {
                if let Some(id) = event.id {
                    self.lock_cards().closed(&id);
                }
            }
            "card_action" => {
                let (Some(id), Some(action)) = (event.id, event.action) else {
                    return;
                };
                // A card that left: a click it reported late is not this
                // capture's to act on.
                if !self.lock_cards().is_up(&id) {
                    tracing::warn!(%id, %action, "capture card action for a card that is not up");
                    return;
                }
                let session = self.clone();
                tauri::async_runtime::spawn(async move { session.card_action(id, action).await });
            }
            other => tracing::warn!(kind = other, "capture event of an unknown type"),
        }
    }

    /// The capsule's stop, or the recording ended by itself: finish it here.
    async fn stopped(self: Arc<Self>, reason: String) {
        // The frontend's stop got there first otherwise.
        let Some(recording) = self.take_recording() else {
            return;
        };
        (self.emit)(CaptureEvent::RecordingStopped { reason });
        // A failure was reported as it happened.
        let _ = self.finish_recording(recording, Finish::Normal).await;
    }

    async fn discarded(self: Arc<Self>) {
        if !matches!(&*self.lock(), State::Recording(_)) {
            return;
        }
        match self.cancel_recording().await {
            Ok(()) => (self.emit)(CaptureEvent::RecordingStopped {
                reason: "discarded".into(),
            }),
            Err(error) => self.failed(error.to_string()),
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
            self.failed(error.to_string());
        }
    }

    pub(crate) fn forget(&self, dropped: &[Entry]) {
        index::forget(&self.layout, dropped);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn card_metadata_past_its_cap_drops_the_oldest_but_never_a_card_that_is_up() {
        let mut cards = Cards::default();
        cards.up.push(("cap-0".into(), Instant::now()));
        for n in 0..=MAX_META + 10 {
            cards.remember(format!("cap-{n}"), Meta::default());
        }
        assert_eq!(cards.meta.len(), MAX_META);
        assert!(cards.meta("cap-0").is_some());
        assert!(cards.meta("cap-1").is_none());
        assert!(cards.meta(&format!("cap-{}", MAX_META + 10)).is_some());
    }
}
