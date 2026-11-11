use std::time::Duration;

use anlg_recording_environment::{Config, Session};
use tauri::ipc::Channel;

use crate::preview::RecordingUpdate;

/// What a dictation asks of the computer's other audio, and of sleep, while
/// it records.
#[derive(Debug, Clone, Copy, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RecordingEnvironment {
    pub config: Config,
    /// Holds the change back this long after the microphone opens, so a
    /// start sound already playing is heard before the output goes quiet.
    /// An output the last capture left quiet is taken over at once instead,
    /// so it does not come back in between.
    pub delay_ms: u32,
}

/// One capture's claim on the environment, from right before its microphone
/// opens (or `delay_ms` later) until its recording loop ends. Dropping it
/// restores what it changed, then tells `updates` the capture has ended once
/// the output is audible again.
pub(crate) struct Quiet {
    session: Option<Session>,
    updates: Option<Channel<RecordingUpdate>>,
}

impl Quiet {
    pub(crate) fn new(
        environment: Option<RecordingEnvironment>,
        updates: Option<Channel<RecordingUpdate>>,
    ) -> Self {
        Self {
            session: environment.map(|environment| {
                anlg_recording_environment::begin(
                    environment.config,
                    Duration::from_millis(environment.delay_ms.into()),
                )
            }),
            updates,
        }
    }
}

impl Drop for Quiet {
    fn drop(&mut self) {
        let updates = self.updates.take();
        let ended = move || {
            if let Some(updates) = updates {
                let _ = updates.send(RecordingUpdate::Ended);
            }
        };
        match self.session.take() {
            Some(session) => session.end_then(ended),
            None => ended(),
        }
    }
}
