use serde::{Deserialize, Serialize};

/// What the dictation HUD is told, as Hex's indicator events: the HUD keeps
/// its own clock for how long each look shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HudEvent {
    /// A recording starts: the HUD appears and follows the microphone.
    Started,
    /// The recording ended and its text is on the way.
    Processing,
    /// The text arrived; the HUD clears and folds away.
    Completed,
    Failed,
    Cancelled,
    /// The live preview's words so far, shown beside the HUD while recording.
    Preview {
        stable: String,
        tentative: String,
    },
}

/// RMS of a buffer of samples, the level the HUD's scope follows.
pub(crate) fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples
        .iter()
        .map(|sample| f64::from(*sample).powi(2))
        .sum();
    (sum / samples.len() as f64).sqrt() as f32
}
