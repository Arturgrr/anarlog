//! The native recorder behind a trait, so the session can be driven by a
//! fake in tests, and the JSON it answers with.

use anlg_annotate_macos::AnnotateError;
use serde::Deserialize;

/// `anlg_annotate_macos`'s calls. `start`, `stop`, `cancel`, `extract_frames` and
/// `probe_screen_recording` block and must run on a worker thread.
pub trait Native: Send + Sync + 'static {
    fn probe_screen_recording(&self) -> Result<String, AnnotateError>;
    fn request_screen_recording(&self) -> Result<bool, AnnotateError>;
    fn open_screen_recording_settings(&self) -> Result<(), AnnotateError>;
    fn start(&self, request: &str) -> Result<String, AnnotateError>;
    fn stop(&self) -> Result<String, AnnotateError>;
    fn cancel(&self) -> Result<(), AnnotateError>;
    fn set_ink_mode(&self, mode: &str) -> Result<(), AnnotateError>;
    fn poll_events(&self) -> Result<String, AnnotateError>;
    fn extract_frames(&self, request: &str) -> Result<String, AnnotateError>;
}

/// The real one: the Swift package on macOS, `unsupported` elsewhere.
pub struct System;

#[cfg(all(target_os = "macos", feature = "private-tcc"))]
fn tcc() -> anlg_annotate_macos::Tcc {
    anlg_tcc::screen_capture_permission_status()
}

#[cfg(not(all(target_os = "macos", feature = "private-tcc")))]
fn tcc() -> anlg_annotate_macos::Tcc {
    anlg_annotate_macos::TCC_UNKNOWN
}

impl Native for System {
    fn probe_screen_recording(&self) -> Result<String, AnnotateError> {
        anlg_annotate_macos::probe_screen_recording(tcc())
    }

    fn request_screen_recording(&self) -> Result<bool, AnnotateError> {
        anlg_annotate_macos::request_screen_recording()
    }

    fn open_screen_recording_settings(&self) -> Result<(), AnnotateError> {
        anlg_annotate_macos::open_screen_recording_settings()
    }

    fn start(&self, request: &str) -> Result<String, AnnotateError> {
        anlg_annotate_macos::start(request)
    }

    fn stop(&self) -> Result<String, AnnotateError> {
        anlg_annotate_macos::stop()
    }

    fn cancel(&self) -> Result<(), AnnotateError> {
        anlg_annotate_macos::cancel()
    }

    fn set_ink_mode(&self, mode: &str) -> Result<(), AnnotateError> {
        anlg_annotate_macos::set_ink_mode(mode)
    }

    fn poll_events(&self) -> Result<String, AnnotateError> {
        anlg_annotate_macos::poll_events()
    }

    fn extract_frames(&self, request: &str) -> Result<String, AnnotateError> {
        anlg_annotate_macos::extract_frames(request)
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct StartReply {
    /// The capture's zero on the host clock (`mach_absolute_time` in ns).
    pub started_host_ns: u64,
    #[serde(default)]
    pub started_wall_ms: i64,
    #[serde(default)]
    pub display: Display,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Display {
    pub width_pt: f64,
    pub height_pt: f64,
    #[serde(default)]
    pub scale: f64,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct FrontApp {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub window_title: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Candidate {
    pub t_ms: i64,
    pub path: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
    pub t_ms: i64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct NativeStroke {
    #[serde(default)]
    pub points: Vec<Point>,
}

/// What `stop` answers. Times are ms from the capture's start.
#[derive(Clone, Debug, Deserialize)]
pub struct StopResult {
    pub video_path: String,
    pub started_wall_ms: i64,
    pub duration_ms: i64,
    #[serde(default)]
    pub video_offset_ms: Option<i64>,
    pub display: Display,
    #[serde(default)]
    pub front_app: FrontApp,
    #[serde(default)]
    pub candidates: Vec<Candidate>,
    #[serde(default)]
    pub strokes: Vec<NativeStroke>,
    #[serde(default)]
    pub ended_by: String,
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// One of `poll_events`' events.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct Event {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ExtractedFrame {
    pub t_ms: i64,
    pub path: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct ExtractReply {
    #[serde(default)]
    pub frames: Vec<ExtractedFrame>,
}
