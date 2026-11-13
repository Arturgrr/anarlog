use serde::{Deserialize, Serialize};

/// What the dictation HUD is told, as Hex's indicator events: the HUD keeps
/// its own clock for how long each look shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HudEvent {
    /// A recording starts: the HUD appears where `position` says and follows
    /// the microphone. Builds that send no position mean the top.
    Started {
        #[serde(default)]
        position: HudPosition,
    },
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

/// Where the dictation HUD shows, from the dictation settings.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum HudPosition {
    /// Below the menu bar, or at the top of the work area.
    #[default]
    Top,
    /// Above the Dock, or at the bottom of the work area.
    Bottom,
    /// Nothing shows, not even the live text.
    Hidden,
    /// Out of a MacBook's notch; as `Top` on a screen without one and off
    /// macOS.
    Notch,
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A build that predates the setting sends `{"type":"started"}`; the HUD
    /// must still start, at the top.
    #[test]
    fn started_without_a_position_is_top_and_round_trips_with_one() {
        let event: HudEvent = serde_json::from_str(r#"{"type":"started"}"#).unwrap();
        assert_eq!(
            event,
            HudEvent::Started {
                position: HudPosition::Top
            }
        );
        let bottom = HudEvent::Started {
            position: HudPosition::Bottom,
        };
        let json = serde_json::to_string(&bottom).unwrap();
        assert_eq!(json, r#"{"type":"started","position":"bottom"}"#);
        assert_eq!(serde_json::from_str::<HudEvent>(&json).unwrap(), bottom);
    }
}
