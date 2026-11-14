//! Screenshots, screen recordings, GIFs and capture cards: thin wrappers
//! over the Swift package's `_capture_*` entry points. Requests and replies
//! are JSON text; every failure is an [`AnnotateError`] whose `code` is one
//! of [`crate::codes`]. On other systems every call returns
//! [`crate::codes::UNSUPPORTED`].
//!
//! Threads: [`screenshot`], [`record_start`], [`record_stop`],
//! [`record_cancel`], [`make_gif`], [`thumbnail`] and [`copy`] block and
//! refuse the main thread with [`crate::codes::MAIN_THREAD`]; call them from
//! a worker. [`screenshot`] and [`record_start`] block for as long as the
//! user takes to select. The others return at once from any thread. The
//! Swift side runs its windows on the main thread, so the host's main run
//! loop must keep running.
//!
//! Coordinates are display points from the display's top-left corner unless
//! a field ends in `_px`.

use crate::{AnnotateError, reply};

fn value(reply: &str) -> Result<String, AnnotateError> {
    reply::parse(reply).map(|value| value.to_string())
}

/// Shows the selector (unless `mode` is `"fullscreen"`) and writes the
/// picture. Request: `{"mode": "area" | "window" | "fullscreen", "out_path",
/// "format": "png" | "jpeg", "jpeg_quality", "thumbnail_path",
/// "thumbnail_long_edge", "show_cursor", "labels": {"area_hint",
/// "window_hint"}}`. Returns `{"status": "captured", "path",
/// "thumbnail_path", "width_px", "height_px", "scale", "kind", "display_id",
/// "rect", "app", "window_title"}` or `{"status": "cancelled"}` as JSON.
pub fn screenshot(request: &str) -> Result<String, AnnotateError> {
    value(&sys::screenshot(request))
}

/// Shows the live selector, counts down and starts recording. Request:
/// `{"mode", "out_path", "fps", "show_cursor", "microphone", "system_audio",
/// "countdown_s", "max_duration_s", "labels": {"area_hint", "window_hint",
/// "discard_question", "discard", "keep"}}`. Returns `{"status":
/// "recording", "kind", "display_id", "rect", "width_px", "height_px",
/// "scale"}` or `{"status": "cancelled"}` as JSON.
pub fn record_start(request: &str) -> Result<String, AnnotateError> {
    value(&sys::record_start(request))
}

/// Ends the recording and waits for the movie: `{"video_path",
/// "duration_ms", "width_px", "height_px", "ended_by": "stop" | "cap" |
/// "stream_error", "warnings"}` as JSON.
pub fn record_stop() -> Result<String, AnnotateError> {
    value(&sys::record_stop())
}

/// Ends the recording, or the selector or countdown before it, and deletes
/// the movie.
pub fn record_cancel() -> Result<(), AnnotateError> {
    reply::parse(&sys::record_cancel()).map(drop)
}

/// `{"phase": "idle" | "selecting" | "countdown" | "recording" |
/// "finishing", "elapsed_ms"}` as JSON.
pub fn record_status() -> Result<String, AnnotateError> {
    value(&sys::record_status())
}

/// What the recording's capsule and the cards asked for since the last
/// call, as a JSON array: `{"type": "record_stop"}`, `{"type":
/// "record_discard"}`, `{"type": "record_stopped", "reason": "cap" |
/// "stream_error"}`, `{"type": "card_action", "id", "action": "copy" |
/// "save" | "edit" | "open" | "close" | "dragged"}`.
pub fn poll_events() -> Result<String, AnnotateError> {
    value(&sys::poll_events())
}

/// Converts a movie to a looping GIF. Request: `{"video", "out_path",
/// "fps", "max_width", "max_frames"}`. Returns `{"path", "width_px",
/// "height_px", "frames", "fps", "bytes"}` as JSON.
pub fn make_gif(request: &str) -> Result<String, AnnotateError> {
    value(&sys::make_gif(request))
}

/// Writes a PNG thumbnail of a picture, GIF or movie (its first frame).
/// Request: `{"source", "out_path", "long_edge"}`. Returns `{"path",
/// "width_px", "height_px"}` as JSON.
pub fn thumbnail(request: &str) -> Result<String, AnnotateError> {
    value(&sys::thumbnail(request))
}

/// Puts a capture on the clipboard. Request: `{"path", "kind": "screenshot"
/// | "gif" | "video"}`.
pub fn copy(request: &str) -> Result<(), AnnotateError> {
    reply::parse(&sys::copy(request)).map(drop)
}

/// Shows a capture's card in the corner of its display. Request: `{"id",
/// "kind", "path", "thumbnail_path", "display_id", "duration_ms", "saved",
/// "labels": {"copy", "save", "show", "edit", "close"}}`.
pub fn card_show(request: &str) -> Result<(), AnnotateError> {
    reply::parse(&sys::card_show(request)).map(drop)
}

/// Closes one card (`{"id"}`) or all of them (`{"all": true}`).
pub fn card_close(request: &str) -> Result<(), AnnotateError> {
    reply::parse(&sys::card_close(request)).map(drop)
}

#[cfg(target_os = "macos")]
mod sys {
    use swift_rs::{SRString, swift};

    swift!(fn _capture_screenshot(request: &SRString) -> SRString);
    swift!(fn _capture_record_start(request: &SRString) -> SRString);
    swift!(fn _capture_record_stop() -> SRString);
    swift!(fn _capture_record_cancel() -> SRString);
    swift!(fn _capture_record_status() -> SRString);
    swift!(fn _capture_poll_events() -> SRString);
    swift!(fn _capture_make_gif(request: &SRString) -> SRString);
    swift!(fn _capture_thumbnail(request: &SRString) -> SRString);
    swift!(fn _capture_copy(request: &SRString) -> SRString);
    swift!(fn _capture_card_show(request: &SRString) -> SRString);
    swift!(fn _capture_card_close(request: &SRString) -> SRString);

    pub fn screenshot(request: &str) -> String {
        unsafe { _capture_screenshot(&SRString::from(request)) }.to_string()
    }

    pub fn record_start(request: &str) -> String {
        unsafe { _capture_record_start(&SRString::from(request)) }.to_string()
    }

    pub fn record_stop() -> String {
        unsafe { _capture_record_stop() }.to_string()
    }

    pub fn record_cancel() -> String {
        unsafe { _capture_record_cancel() }.to_string()
    }

    pub fn record_status() -> String {
        unsafe { _capture_record_status() }.to_string()
    }

    pub fn poll_events() -> String {
        unsafe { _capture_poll_events() }.to_string()
    }

    pub fn make_gif(request: &str) -> String {
        unsafe { _capture_make_gif(&SRString::from(request)) }.to_string()
    }

    pub fn thumbnail(request: &str) -> String {
        unsafe { _capture_thumbnail(&SRString::from(request)) }.to_string()
    }

    pub fn copy(request: &str) -> String {
        unsafe { _capture_copy(&SRString::from(request)) }.to_string()
    }

    pub fn card_show(request: &str) -> String {
        unsafe { _capture_card_show(&SRString::from(request)) }.to_string()
    }

    pub fn card_close(request: &str) -> String {
        unsafe { _capture_card_close(&SRString::from(request)) }.to_string()
    }
}

#[cfg(not(target_os = "macos"))]
mod sys {
    const UNSUPPORTED: &str =
        r#"{"ok":false,"error":{"code":"unsupported","message":"Capture works only on macOS"}}"#;

    fn unsupported() -> String {
        UNSUPPORTED.to_owned()
    }

    pub fn screenshot(_request: &str) -> String {
        unsupported()
    }

    pub fn record_start(_request: &str) -> String {
        unsupported()
    }

    pub fn record_stop() -> String {
        unsupported()
    }

    pub fn record_cancel() -> String {
        unsupported()
    }

    pub fn record_status() -> String {
        unsupported()
    }

    pub fn poll_events() -> String {
        unsupported()
    }

    pub fn make_gif(_request: &str) -> String {
        unsupported()
    }

    pub fn thumbnail(_request: &str) -> String {
        unsupported()
    }

    pub fn copy(_request: &str) -> String {
        unsupported()
    }

    pub fn card_show(_request: &str) -> String {
        unsupported()
    }

    pub fn card_close(_request: &str) -> String {
        unsupported()
    }
}

#[cfg(all(test, not(target_os = "macos")))]
mod tests {
    use super::*;

    #[test]
    fn every_capture_call_says_unsupported_off_macos() {
        let code = crate::codes::UNSUPPORTED;
        assert_eq!(screenshot("{}").unwrap_err().code, code);
        assert_eq!(record_start("{}").unwrap_err().code, code);
        assert_eq!(record_stop().unwrap_err().code, code);
        assert_eq!(record_cancel().unwrap_err().code, code);
        assert_eq!(poll_events().unwrap_err().code, code);
        assert_eq!(card_show("{}").unwrap_err().code, code);
    }
}
