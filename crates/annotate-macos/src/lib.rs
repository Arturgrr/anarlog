//! Annotate's native macOS layer: records the display under the pointer
//! with ScreenCaptureKit while the user inks over it, and reads frames back
//! from the movie. All of it lives in the Swift package in `swift-lib/`;
//! these are thin wrappers over its C entry points. Every call returns
//! plain values or JSON text, and every failure is an [`AnnotateError`]
//! whose `code` is one of [`codes`]. On other systems every call returns
//! [`codes::UNSUPPORTED`].
//!
//! Threads: [`start`], [`stop`], [`cancel`], [`probe_screen_recording`] and
//! [`extract_frames`] block (up to about a minute for `stop`) and refuse the
//! main thread with [`codes::MAIN_THREAD`]; call them from a worker. The
//! others return at once from any thread. The Swift side runs its windows on
//! the main thread, so the host's main run loop must keep running.
//!
//! A recording: [`start`], then poll [`poll_events`] (about every 100 ms)
//! and act on `stop` (call [`stop`]), `discard` (call [`cancel`]) and
//! `stopped` (the 20-minute cap or a stream failure ended it: call [`stop`]
//! for its result). [`set_ink_mode`] follows the host's shortcut. [`status`]
//! tells where a host that lost track stands.

mod reply;

pub use reply::{AnnotateError, codes};

/// What [`start`] takes, as JSON.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct StartRequest {
    /// An absolute directory; created when missing.
    pub dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub labels: Option<Labels>,
}

/// The capsule's words; one left out stays English.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct Labels {
    /// "Discard?"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discard_question: Option<String>,
    /// "Discard"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discard: Option<String>,
    /// "Keep"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep: Option<String>,
}

impl StartRequest {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

/// Whether this process can record the screen, read afresh:
/// `"granted"`, `"denied"`, `"not_determined"` (never asked), or
/// `"needs_restart"` (granted in System Settings, but this process can't
/// record until it restarts). Blocks up to about 5 s.
pub fn probe_screen_recording() -> Result<String, AnnotateError> {
    reply::parse(&sys::probe()).and_then(reply::expect_string)
}

/// Shows the system's Screen Recording prompt, which macOS shows once per
/// app; later calls show nothing. Returns whether access is granted, as the
/// possibly stale preflight sees it.
pub fn request_screen_recording() -> Result<bool, AnnotateError> {
    reply::parse(&sys::request()).and_then(reply::expect_bool)
}

/// Opens System Settings at Privacy & Security › Screen Recording.
pub fn open_screen_recording_settings() -> Result<(), AnnotateError> {
    reply::parse(&sys::open_settings()).map(drop)
}

/// Starts recording the display under the pointer into
/// `{"dir": "/abs/path"}`: `recording.mp4` and `candidates/`. An optional
/// `"labels": {"discard_question", "discard", "keep"}` puts the capsule's
/// words in the host's language; each one left out stays English. Returns the
/// start as JSON (`started_host_ticks`, `started_host_ns`,
/// `started_wall_ms`, `display`). Blocks until the stream runs.
pub fn start(request: &str) -> Result<String, AnnotateError> {
    reply::parse(&sys::start(request)).map(|value| value.to_string())
}

/// Stops the recording, finishes the movie and returns its result as JSON.
/// After a `stopped` event it returns that recording's result.
pub fn stop() -> Result<String, AnnotateError> {
    reply::parse(&sys::stop()).map(|value| value.to_string())
}

/// Stops the recording and deletes what it wrote. Also discards a result
/// a `stopped` event left unclaimed. Nothing to cancel is not an error.
pub fn cancel() -> Result<(), AnnotateError> {
    reply::parse(&sys::cancel()).map(drop)
}

/// `"off"`, `"hover"` (the pointer inks as it moves) or `"drag"` (inks
/// while the button is held). Only while recording.
pub fn set_ink_mode(mode: &str) -> Result<(), AnnotateError> {
    reply::parse(&sys::set_ink_mode(mode)).map(drop)
}

/// The capsule's and the safety timers' events since the last call, as a
/// JSON array (`[{"type":"stop"}]`).
pub fn poll_events() -> Result<String, AnnotateError> {
    reply::parse(&sys::poll_events()).map(|value| value.to_string())
}

/// `{"phase", "elapsed_ms", "ink", "result_pending"}` as JSON.
pub fn status() -> Result<String, AnnotateError> {
    reply::parse(&sys::status()).map(|value| value.to_string())
}

/// Writes full-resolution PNG frames from a finished movie:
/// `{"video", "video_offset_ms", "times_ms": [..], "dir"}`. Returns
/// `{"frames": [..], "failed": [..]}` as JSON.
pub fn extract_frames(request: &str) -> Result<String, AnnotateError> {
    reply::parse(&sys::extract_frames(request)).map(|value| value.to_string())
}

#[cfg(target_os = "macos")]
mod sys {
    use swift_rs::{SRString, swift};

    swift!(fn _annotate_probe() -> SRString);
    swift!(fn _annotate_request() -> SRString);
    swift!(fn _annotate_open_settings() -> SRString);
    swift!(fn _annotate_start(request: &SRString) -> SRString);
    swift!(fn _annotate_stop() -> SRString);
    swift!(fn _annotate_cancel() -> SRString);
    swift!(fn _annotate_set_ink_mode(mode: &SRString) -> SRString);
    swift!(fn _annotate_poll_events() -> SRString);
    swift!(fn _annotate_status() -> SRString);
    swift!(fn _annotate_extract_frames(request: &SRString) -> SRString);

    pub fn probe() -> String {
        unsafe { _annotate_probe() }.to_string()
    }

    pub fn request() -> String {
        unsafe { _annotate_request() }.to_string()
    }

    pub fn open_settings() -> String {
        unsafe { _annotate_open_settings() }.to_string()
    }

    pub fn start(request: &str) -> String {
        unsafe { _annotate_start(&SRString::from(request)) }.to_string()
    }

    pub fn stop() -> String {
        unsafe { _annotate_stop() }.to_string()
    }

    pub fn cancel() -> String {
        unsafe { _annotate_cancel() }.to_string()
    }

    pub fn set_ink_mode(mode: &str) -> String {
        unsafe { _annotate_set_ink_mode(&SRString::from(mode)) }.to_string()
    }

    pub fn poll_events() -> String {
        unsafe { _annotate_poll_events() }.to_string()
    }

    pub fn status() -> String {
        unsafe { _annotate_status() }.to_string()
    }

    pub fn extract_frames(request: &str) -> String {
        unsafe { _annotate_extract_frames(&SRString::from(request)) }.to_string()
    }
}

#[cfg(not(target_os = "macos"))]
mod sys {
    const UNSUPPORTED: &str =
        r#"{"ok":false,"error":{"code":"unsupported","message":"Annotate records only on macOS"}}"#;

    pub fn probe() -> String {
        UNSUPPORTED.to_owned()
    }

    pub fn request() -> String {
        UNSUPPORTED.to_owned()
    }

    pub fn open_settings() -> String {
        UNSUPPORTED.to_owned()
    }

    pub fn start(_request: &str) -> String {
        UNSUPPORTED.to_owned()
    }

    pub fn stop() -> String {
        UNSUPPORTED.to_owned()
    }

    pub fn cancel() -> String {
        UNSUPPORTED.to_owned()
    }

    pub fn set_ink_mode(_mode: &str) -> String {
        UNSUPPORTED.to_owned()
    }

    pub fn poll_events() -> String {
        UNSUPPORTED.to_owned()
    }

    pub fn status() -> String {
        UNSUPPORTED.to_owned()
    }

    pub fn extract_frames(_request: &str) -> String {
        UNSUPPORTED.to_owned()
    }
}
