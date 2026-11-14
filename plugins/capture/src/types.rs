//! What the frontend sends and gets back.

use anlg_capture_core::{Entry, Kind};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum CaptureMode {
    /// The selector, starting in area mode.
    Area,
    /// The selector, starting in window mode.
    Window,
    /// The display under the pointer, without a selector for screenshots.
    Fullscreen,
}

impl CaptureMode {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Area => "area",
            Self::Window => "window",
            Self::Fullscreen => "fullscreen",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum ImageFormat {
    Png,
    Jpeg,
}

impl From<ImageFormat> for anlg_capture_core::ImageFormat {
    fn from(format: ImageFormat) -> Self {
        match format {
            ImageFormat::Png => Self::Png,
            ImageFormat::Jpeg => Self::Jpeg,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum RecordingOutput {
    Mp4,
    Gif,
}

/// The overlays' and cards' words in the app's language; one left out stays
/// English.
#[derive(Clone, Debug, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct CaptureLabels {
    pub area_hint: Option<String>,
    pub window_hint: Option<String>,
    pub discard_question: Option<String>,
    pub discard: Option<String>,
    pub keep: Option<String>,
    pub copy: Option<String>,
    pub save: Option<String>,
    pub show: Option<String>,
    pub edit: Option<String>,
    pub close: Option<String>,
}

fn or(label: &Option<String>, english: &str) -> String {
    label
        .as_deref()
        .filter(|label| !label.trim().is_empty())
        .unwrap_or(english)
        .to_owned()
}

impl CaptureLabels {
    pub(crate) fn screenshot_json(&self) -> serde_json::Value {
        serde_json::json!({
            "area_hint": or(&self.area_hint, "Drag to capture · Space for a window · Esc to cancel"),
            "window_hint": or(&self.window_hint, "Click a window · Space for an area · Esc to cancel"),
        })
    }

    pub(crate) fn recording_json(&self) -> serde_json::Value {
        serde_json::json!({
            "area_hint": or(
                &self.area_hint,
                "Drag to record · Space for a window · Return for the whole screen · Esc to cancel",
            ),
            "window_hint": or(&self.window_hint, "Click a window · Space for an area · Esc to cancel"),
            "discard_question": or(&self.discard_question, "Discard?"),
            "discard": or(&self.discard, "Discard"),
            "keep": or(&self.keep, "Keep"),
        })
    }

    pub(crate) fn card_json(&self) -> serde_json::Value {
        serde_json::json!({
            "copy": or(&self.copy, "Copy"),
            "save": or(&self.save, "Save"),
            "show": or(&self.show, "Show in Finder"),
            "edit": or(&self.edit, "Edit"),
            "close": or(&self.close, "Close"),
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotRequest {
    pub mode: CaptureMode,
    pub format: ImageFormat,
    pub show_cursor: bool,
    /// Put it on the clipboard.
    pub copy: bool,
    /// Where to save it: null keeps it in the library only, empty is the
    /// user's Downloads, anything else must be an absolute folder.
    pub save_dir: Option<String>,
    /// The folder the card's Save moves a library capture to (the
    /// `capture_folder` setting); null or empty is Downloads.
    pub folder: Option<String>,
    pub show_card: bool,
    pub labels: CaptureLabels,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RecordingRequest {
    pub mode: CaptureMode,
    pub output: RecordingOutput,
    /// 30 or 60.
    pub fps: u32,
    pub show_cursor: bool,
    pub microphone: bool,
    pub system_audio: bool,
    /// 0 or 3.
    pub countdown_s: u32,
    pub gif_fps: u32,
    pub gif_max_width: u32,
    pub copy: bool,
    /// As in [`ScreenshotRequest::save_dir`].
    pub save_dir: Option<String>,
    /// As in [`ScreenshotRequest::folder`].
    pub folder: Option<String>,
    pub show_card: bool,
    pub labels: CaptureLabels,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum CaptureKind {
    Screenshot,
    Video,
    Gif,
}

impl From<Kind> for CaptureKind {
    fn from(kind: Kind) -> Self {
        match kind {
            Kind::Screenshot => Self::Screenshot,
            Kind::Video => Self::Video,
            Kind::Gif => Self::Gif,
        }
    }
}

/// A capture in the list, newest first.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CaptureEntry {
    /// `cap-<createdMs>-<4 hex>`.
    pub id: String,
    pub kind: CaptureKind,
    pub path: String,
    /// Empty when no thumbnail could be made.
    pub thumbnail_path: String,
    pub created_ms: i64,
    /// Pixels.
    pub width: u32,
    pub height: u32,
    /// Pixels a point.
    pub scale: f64,
    /// 0 for screenshots.
    pub duration_ms: u64,
    pub bytes: u64,
    /// The file is in the library, not saved to a folder of the user's.
    pub in_library: bool,
}

impl From<Entry> for CaptureEntry {
    fn from(entry: Entry) -> Self {
        Self {
            id: entry.id,
            kind: entry.kind.into(),
            path: entry.path,
            thumbnail_path: entry.thumbnail_path,
            created_ms: entry.created_ms,
            width: entry.width,
            height: entry.height,
            scale: entry.scale,
            duration_ms: entry.duration_ms,
            bytes: entry.bytes,
            in_library: entry.in_library,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum CaptureOutcome {
    Captured { entry: CaptureEntry },
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum RecordingStart {
    Recording { output: RecordingOutput },
    Cancelled,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum CapturePhase {
    Idle,
    /// A selector, or a recording's countdown, is up.
    Selecting,
    Recording,
    /// Saving a screenshot or finishing a recording.
    Finishing,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus {
    /// False off macOS, where nothing captures.
    pub available: bool,
    pub phase: CapturePhase,
    /// How long the recording has run; 0 otherwise.
    pub elapsed_ms: u64,
}

/// Which of macOS's own screenshot shortcuts are on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemShortcuts {
    /// ⌘⇧4.
    pub area: bool,
    /// ⌘⇧3.
    pub fullscreen: bool,
    /// ⌘⇧5.
    pub options: bool,
    /// Librelog turned them off and remembers how they were.
    pub replaced: bool,
}
