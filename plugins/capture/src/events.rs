use serde::{Deserialize, Serialize};

use crate::types::{CaptureEntry, RecordingOutput};

/// What a card asks the frontend for; its other buttons are handled here.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum CardActionKind {
    /// Open the screenshot in the editor.
    Edit,
    /// Open the recording.
    Open,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CaptureEvent {
    /// A capture was saved, indexed and, per its request, copied and shown
    /// on a card.
    Captured {
        entry: CaptureEntry,
    },
    RecordingStarted {
        output: RecordingOutput,
    },
    /// The recording ended without the frontend asking: `stop` (the
    /// capsule's stop), `cap` (the length limit) or `stream_error`, each
    /// followed by `captured` (or `failed`) once it is finished; or
    /// `discarded` (the capsule's discard), after which nothing follows.
    RecordingStopped {
        reason: String,
    },
    /// Something after the capture failed: finishing a recording on its own,
    /// copying, a card's button, or making the GIF (then the movie is kept).
    Failed {
        message: String,
    },
    CardAction {
        id: String,
        action: CardActionKind,
    },
}
