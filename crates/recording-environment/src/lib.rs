//! Quiets the computer's other audio while a dictation records and keeps it
//! from idle sleep, then puts everything back.
//!
//! ```no_run
//! use std::time::Duration;
//!
//! use recording_environment::{AudioBehavior, Config};
//!
//! # let app_data_dir = std::env::temp_dir();
//! // At startup, once, before the first dictation.
//! recording_environment::recover(app_data_dir);
//!
//! // When a capture starts, before the microphone opens. It returns at once.
//! let environment = recording_environment::begin(Config {
//!     behavior: AudioBehavior::Duck { volume: 0.2 },
//!     prevent_sleep: true,
//! });
//! // ... record; the capture ends, by stopping, cancelling or failing:
//! environment.end(); // dropping it does the same
//!
//! // When the app quits.
//! recording_environment::shutdown(Duration::from_secs(2));
//! ```
//!
//! Every change is best effort: a backend that is missing or fails logs and
//! leaves that part alone, and never fails the dictation. One worker thread
//! owns every change, so `begin`, `end` and dropping a [`Session`] only send
//! it a message. Overlapping sessions share each change: the first one that
//! wants it applies it, and it is restored once the last one ends and no new
//! session wants it within [`RESTORE_GRACE`], so captures that follow each
//! other keep the output quiet instead of capturing a lowered volume as the
//! original.
//!
//! The `macos-private-api` feature lets "Pause media" pause a browser on
//! macOS; enable it only for direct distribution, never the App Store.

mod coordinator;
#[cfg(any(target_os = "linux", target_os = "windows", test))]
mod media;
mod mute;
mod native;
mod ramp;
mod records;

#[cfg(any(all(target_os = "macos", feature = "macos-private-api"), test))]
mod browser;

use std::path::PathBuf;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, SendError, Sender};
use std::time::Duration;

use coordinator::{Command, Effect};

/// How long a change outlives the session that made it, so the next capture
/// of a queue or a double tap finds the output still quiet.
pub const RESTORE_GRACE: Duration = Duration::from_millis(300);

/// "Lower audio" volume when a setting carries no usable one, as a fraction
/// of the output's volume.
pub const DEFAULT_DUCK_VOLUME: f32 = 0.2;

/// What happens to other audio while dictating.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AudioBehavior {
    Nothing,
    /// Mutes the default output, unless it is muted already.
    Mute,
    /// Ramps the default output down to `volume`, a fraction (0 to 1) of
    /// its volume when the dictation starts, keeping its channel balance.
    Duck {
        volume: f32,
    },
    /// Pauses media players that are playing and resumes those it paused.
    /// On macOS `browsers` also pauses a browser that is audibly playing;
    /// Windows and Linux report browser tabs like any other player, so they
    /// are paused either way.
    PauseMedia {
        browsers: bool,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub behavior: AudioBehavior,
    /// Keeps the computer from idle sleep while the session lasts.
    pub prevent_sleep: bool,
}

impl Config {
    fn effects(self) -> Vec<Effect> {
        let mut effects = Vec::new();
        match self.behavior {
            AudioBehavior::Nothing => {}
            AudioBehavior::Mute => effects.push(Effect::Mute),
            AudioBehavior::Duck { volume } => effects.push(Effect::Duck {
                volume: if volume.is_finite() {
                    volume.clamp(0.0, 1.0)
                } else {
                    DEFAULT_DUCK_VOLUME
                },
            }),
            AudioBehavior::PauseMedia { browsers } => effects.push(Effect::Pause { browsers }),
        }
        if self.prevent_sleep {
            effects.push(Effect::Sleep);
        }
        effects
    }
}

/// Applies `config` until the returned session ends or drops. Returns at
/// once; the changes, and any volume ramp, happen on a worker thread.
pub fn begin(config: Config) -> Session {
    let effects = config.effects();
    if effects.is_empty() {
        return Session::inert();
    }
    let Some(commands) = worker() else {
        return Session::inert();
    };
    static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);
    let id = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
    if commands
        .send(Command::Begin {
            session: id,
            effects,
        })
        .is_err()
    {
        return Session::inert();
    }
    Session {
        id,
        commands: Some(commands.clone()),
    }
}

/// One dictation's claim on the environment. Ending it twice is impossible,
/// and dropping it ends it, so every exit path restores.
#[must_use = "dropping a session ends it at once"]
pub struct Session {
    id: u64,
    commands: Option<Sender<Command>>,
}

impl Session {
    fn inert() -> Self {
        Self {
            id: 0,
            commands: None,
        }
    }

    /// Restores what this session changed, unless another live session
    /// still wants it. Returns at once.
    pub fn end(self) {}

    /// Like [`end`](Self::end), and runs `then` once a muted or lowered
    /// output is audible again, so a stop sound it plays is heard. With
    /// nothing to unmute, or another session keeping the output quiet, it
    /// runs at once on the worker thread; resuming media never delays it.
    pub fn end_then(mut self, then: impl FnOnce() + Send + 'static) {
        let Some(commands) = self.commands.take() else {
            return then();
        };
        let command = Command::End {
            session: self.id,
            then: Some(Box::new(then)),
        };
        if let Err(SendError(Command::End {
            then: Some(then), ..
        })) = commands.send(command)
        {
            then();
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if let Some(commands) = self.commands.take() {
            let _ = commands.send(Command::End {
                session: self.id,
                then: None,
            });
        }
    }
}

/// Restores what a previous run of the app left changed when it died while
/// dictating, and keeps a record in `state_dir` from now on so the next run
/// can do the same for this one. Call once at startup; without it nothing is
/// recorded. Only a muted or lowered output is restored, and only while it
/// is still as that run left it: media it paused stays paused, and the OS
/// already released its sleep prevention when the process ended.
pub fn recover(state_dir: impl Into<PathBuf>) {
    let state_dir = state_dir.into();
    records::set_dir(state_dir.clone());
    if let Some(commands) = worker() {
        let _ = commands.send(Command::Run(Box::new(move || {
            native::recover(&state_dir);
        })));
    }
}

/// Restores everything now, sessions still alive included, and waits up to
/// `timeout` for it. Call before the app exits, which would otherwise leave
/// the output muted or lowered. Returns whether everything was restored.
pub fn shutdown(timeout: Duration) -> bool {
    let Some(Some(commands)) = WORKER.get() else {
        return true;
    };
    let (done, finished) = mpsc::channel();
    if commands.send(Command::Shutdown(done)).is_err() {
        return true;
    }
    let restored = finished.recv_timeout(timeout).is_ok();
    if !restored {
        tracing::warn!("quit before restoring the audio changed for dictation");
    }
    restored
}

static WORKER: OnceLock<Option<Sender<Command>>> = OnceLock::new();

fn worker() -> Option<&'static Sender<Command>> {
    WORKER
        .get_or_init(|| {
            coordinator::spawn(RESTORE_GRACE, native::Native::new)
                .inspect_err(
                    |error| tracing::warn!(%error, "could not start the recording environment"),
                )
                .ok()
        })
        .as_ref()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_settings_shape_deserializes_into_a_config() {
        let config: Config = serde_json::from_str(
            r#"{"behavior":{"type":"pauseMedia","browsers":true},"preventSleep":true}"#,
        )
        .unwrap();
        assert_eq!(
            config,
            Config {
                behavior: AudioBehavior::PauseMedia { browsers: true },
                prevent_sleep: true,
            }
        );
        let config: Config = serde_json::from_str(
            r#"{"behavior":{"type":"duck","volume":0.35},"preventSleep":false}"#,
        )
        .unwrap();
        assert_eq!(config.behavior, AudioBehavior::Duck { volume: 0.35 });
    }
}
