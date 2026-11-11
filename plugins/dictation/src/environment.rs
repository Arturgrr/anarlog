use std::time::Duration;

use anlg_recording_environment::{Config, Session};
use tauri::ipc::Channel;
use tokio::time::Instant;

use crate::preview::RecordingUpdate;

/// What a dictation asks of the computer's other audio, and of sleep, while
/// it records.
#[derive(Debug, Clone, Copy, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RecordingEnvironment {
    pub config: Config,
    /// Holds the change back this long after the microphone opens, so a
    /// start sound already playing is heard before the output goes quiet.
    pub delay_ms: u32,
}

/// One capture's claim on the environment, from right before its microphone
/// opens (or `delay_ms` later) until its recording loop ends. Dropping it
/// restores what it changed, then tells `updates` the capture has ended once
/// the output is audible again.
pub(crate) struct Quiet {
    pending: Option<(Config, Instant)>,
    session: Option<Session>,
    updates: Option<Channel<RecordingUpdate>>,
}

impl Quiet {
    pub(crate) fn new(
        environment: Option<RecordingEnvironment>,
        updates: Option<Channel<RecordingUpdate>>,
    ) -> Self {
        let mut quiet = Self {
            pending: environment.map(|environment| {
                (
                    environment.config,
                    Instant::now() + Duration::from_millis(environment.delay_ms.into()),
                )
            }),
            session: None,
            updates,
        };
        if quiet.begin_at().is_some_and(|at| at <= Instant::now()) {
            quiet.begin();
        }
        quiet
    }

    /// When the held-back change is due, if one still is.
    pub(crate) fn begin_at(&self) -> Option<Instant> {
        self.pending.map(|(_, at)| at)
    }

    pub(crate) fn begin(&mut self) {
        if let Some((config, _)) = self.pending.take() {
            self.session = Some(anlg_recording_environment::begin(config));
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
