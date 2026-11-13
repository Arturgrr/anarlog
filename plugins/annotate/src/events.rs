use serde::{Deserialize, Serialize};

/// A recording that stopped and waits for its transcript: pass `id` to
/// `finalize`.
#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Stopped {
    pub id: String,
    pub dir: String,
    /// `audio.wav`, aligned to the capture's start; absent when the
    /// microphone failed.
    pub audio_path: Option<String>,
    pub duration_ms: u32,
    /// `stop`, `max_duration` or `stream_error`.
    pub ended_by: String,
    pub warnings: Vec<String>,
}

/// What the recording did by itself or through its capsule.
#[derive(Clone, Debug, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AnnotateEvent {
    /// The capsule's stop, the 20-minute cap or a failed stream ended the
    /// recording; it waits for `finalize`.
    Stopped { stopped: Stopped },
    /// The capsule's Discard: the recording and its folder are gone.
    Discarded,
    /// Ink came on or went off from the capsule's pen, Escape or idling.
    Ink { on: bool },
    /// Ending the recording failed; the session is idle again.
    Failed { message: String },
}
