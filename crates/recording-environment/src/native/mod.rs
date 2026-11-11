//! The OS backends behind the worker: each platform module provides the
//! output to mute and lower, the media pause, and the sleep prevention.

use std::path::Path;

use crate::coordinator::{Effect, Environment};
use crate::{mute, ramp, records};

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
use linux as platform;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos as platform;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
use windows as platform;

pub(crate) struct Native;

impl Native {
    pub(crate) fn new() -> Self {
        platform::init_thread();
        Self
    }
}

/// What one effect holds; dropping it restores.
pub(crate) enum Held {
    Muted {
        _guard: mute::Guard<platform::MuteOutput>,
    },
    Lowered {
        _guard: ramp::Guard,
    },
    Paused {
        _guard: platform::Paused,
    },
    Awake {
        _guard: platform::Awake,
    },
    Nothing,
}

impl Environment for Native {
    type Held = Held;

    fn hold(&mut self, effect: Effect) -> Held {
        match effect {
            Effect::Mute => match platform::mute_output() {
                Some(output) => mute::Guard::start(output)
                    .map_or(Held::Nothing, |guard| Held::Muted { _guard: guard }),
                None => {
                    tracing::warn!("cannot mute: no output to mute");
                    Held::Nothing
                }
            },
            Effect::Duck { volume } => ramp::Guard::start(volume, || {
                platform::init_thread();
                let output = platform::duck_output();
                if output.is_none() {
                    tracing::warn!("cannot lower the output: its volume cannot be set");
                }
                output
            })
            .map_or(Held::Nothing, |guard| Held::Lowered { _guard: guard }),
            Effect::Pause { browsers } => platform::pause_media(browsers)
                .map_or(Held::Nothing, |guard| Held::Paused { _guard: guard }),
            Effect::Sleep => match platform::Awake::start() {
                Ok(awake) => Held::Awake { _guard: awake },
                Err(error) => {
                    tracing::warn!(%error, "could not keep the computer awake while dictating");
                    Held::Nothing
                }
            },
        }
    }
}

pub(crate) fn recover(dir: &Path) {
    for (path, record) in records::leftovers(dir) {
        if let Some(muted) = &record.muted
            && let Some(mut output) = platform::recorded_mute_output(muted)
        {
            mute::recover(&mut output);
        }
        if let Some(ducked) = &record.ducked
            && let Some(mut output) = platform::recorded_duck_output(&ducked.output)
        {
            ramp::recover(&mut output, ducked);
        }
        if let Err(error) = std::fs::remove_file(&path) {
            tracing::warn!(%error, "could not remove a previous run's audio record");
        }
    }
}
