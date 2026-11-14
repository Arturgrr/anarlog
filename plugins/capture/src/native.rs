//! The native layer behind a trait, so the session can be driven by a fake
//! in tests, and the JSON it answers with.

use std::path::Path;

use anlg_annotate_macos::{AnnotateError, capture, codes};
use serde::Deserialize;

/// `anlg_annotate_macos::capture`'s calls, plus revealing a file in Finder
/// and moving one to the Trash. `screenshot`, `record_start`, `record_stop`,
/// `record_cancel`, `make_gif`, `thumbnail`, `copy` and `trash` block and
/// must run on a worker thread.
pub trait Native: Send + Sync + 'static {
    /// False where nothing captures (off macOS): no command then touches
    /// the disk.
    fn available(&self) -> bool;
    fn screenshot(&self, request: &str) -> Result<String, AnnotateError>;
    fn record_start(&self, request: &str) -> Result<String, AnnotateError>;
    fn record_stop(&self) -> Result<String, AnnotateError>;
    fn record_cancel(&self) -> Result<(), AnnotateError>;
    fn record_status(&self) -> Result<String, AnnotateError>;
    fn poll_events(&self) -> Result<String, AnnotateError>;
    fn make_gif(&self, request: &str) -> Result<String, AnnotateError>;
    fn thumbnail(&self, request: &str) -> Result<String, AnnotateError>;
    fn copy(&self, request: &str) -> Result<(), AnnotateError>;
    fn card_show(&self, request: &str) -> Result<(), AnnotateError>;
    fn card_close(&self, request: &str) -> Result<(), AnnotateError>;
    fn reveal(&self, path: &Path) -> Result<(), AnnotateError>;
    fn trash(&self, path: &Path) -> Result<(), AnnotateError>;
}

/// The real one: the Swift package on macOS, `unsupported` elsewhere.
pub struct System;

fn failure(code: &str, message: impl std::fmt::Display) -> AnnotateError {
    AnnotateError {
        code: code.to_owned(),
        message: message.to_string(),
    }
}

impl Native for System {
    fn available(&self) -> bool {
        cfg!(target_os = "macos")
    }

    fn screenshot(&self, request: &str) -> Result<String, AnnotateError> {
        capture::screenshot(request)
    }

    fn record_start(&self, request: &str) -> Result<String, AnnotateError> {
        capture::record_start(request)
    }

    fn record_stop(&self) -> Result<String, AnnotateError> {
        capture::record_stop()
    }

    fn record_cancel(&self) -> Result<(), AnnotateError> {
        capture::record_cancel()
    }

    fn record_status(&self) -> Result<String, AnnotateError> {
        capture::record_status()
    }

    fn poll_events(&self) -> Result<String, AnnotateError> {
        capture::poll_events()
    }

    fn make_gif(&self, request: &str) -> Result<String, AnnotateError> {
        capture::make_gif(request)
    }

    fn thumbnail(&self, request: &str) -> Result<String, AnnotateError> {
        capture::thumbnail(request)
    }

    fn copy(&self, request: &str) -> Result<(), AnnotateError> {
        capture::copy(request)
    }

    fn card_show(&self, request: &str) -> Result<(), AnnotateError> {
        capture::card_show(request)
    }

    fn card_close(&self, request: &str) -> Result<(), AnnotateError> {
        capture::card_close(request)
    }

    fn reveal(&self, path: &Path) -> Result<(), AnnotateError> {
        tauri_plugin_opener::reveal_item_in_dir(path).map_err(|error| failure(codes::IO, error))
    }

    #[cfg(target_os = "macos")]
    fn trash(&self, path: &Path) -> Result<(), AnnotateError> {
        use objc2_foundation::{NSFileManager, NSString, NSURL};
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        NSFileManager::defaultManager()
            .trashItemAtURL_resultingItemURL_error(&url, None)
            .map_err(|error| failure(codes::IO, error.localizedDescription()))
    }

    #[cfg(not(target_os = "macos"))]
    fn trash(&self, _path: &Path) -> Result<(), AnnotateError> {
        Err(failure(
            codes::UNSUPPORTED,
            "The Trash is only used on macOS",
        ))
    }
}

/// What `screenshot` answers: `status` is `captured` or `cancelled`.
#[derive(Clone, Debug, Deserialize)]
pub struct ScreenshotReply {
    pub status: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub thumbnail_path: Option<String>,
    #[serde(default)]
    pub width_px: u32,
    #[serde(default)]
    pub height_px: u32,
    #[serde(default)]
    pub scale: f64,
    #[serde(default)]
    pub display_id: Option<u64>,
}

/// What `record_start` answers: `status` is `recording` or `cancelled`.
#[derive(Clone, Debug, Deserialize)]
pub struct RecordStartReply {
    pub status: String,
    #[serde(default)]
    pub display_id: Option<u64>,
    #[serde(default)]
    pub scale: f64,
}

/// What `record_stop` answers; every field may be missing.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct RecordStopReply {
    pub video_path: Option<String>,
    #[serde(default)]
    pub duration_ms: u64,
    #[serde(default)]
    pub width_px: u32,
    #[serde(default)]
    pub height_px: u32,
    #[serde(default)]
    pub ended_by: String,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct RecordStatus {
    #[serde(default)]
    pub elapsed_ms: u64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct GifReply {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub width_px: u32,
    #[serde(default)]
    pub height_px: u32,
}

/// One of `poll_events`' events.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct Event {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub action: Option<String>,
}
