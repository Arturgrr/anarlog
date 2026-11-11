//! Linux, adapted from Hex's audio control: the default sink through
//! PulseAudio's `pactl` (also served by PipeWire), else PipeWire's `wpctl`;
//! players over MPRIS on the session D-Bus; a logind inhibitor on the
//! system D-Bus.

use std::process::Command;
use std::time::Duration;

use zbus::Connection;
use zbus::zvariant::{OwnedFd, OwnedValue};

use crate::media::{self, Players};
use crate::{mute, ramp, records};

const MPRIS_PREFIX: &str = "org.mpris.MediaPlayer2.";
const MPRIS_PATH: &str = "/org/mpris/MediaPlayer2";
const MPRIS_PLAYER: &str = "org.mpris.MediaPlayer2.Player";
const DBUS_TIMEOUT: Duration = Duration::from_millis(500);
const WPCTL_SINK: &str = "@DEFAULT_AUDIO_SINK@";
/// pactl's raw volume for 100%.
const PA_VOLUME_NORM: f32 = 65536.0;

pub(crate) fn init_thread() {}

/// A sink named through `pactl`, so restoring reaches the sink that was
/// changed even if the default moves meanwhile, else `wpctl`'s default.
pub(crate) enum Sink {
    Pactl(String),
    Wpctl,
}

pub(crate) type MuteOutput = Sink;

impl Sink {
    fn default_pactl() -> Self {
        let name = run("pactl", &["get-default-sink"])
            .map(|output| output.trim().to_owned())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "@DEFAULT_SINK@".to_owned());
        Self::Pactl(name)
    }

    fn from_id(id: &str) -> Option<Self> {
        match id.strip_prefix("pactl:") {
            Some(name) => Some(Self::Pactl(name.to_owned())),
            None => (id == "wpctl").then_some(Self::Wpctl),
        }
    }

    fn id(&self) -> String {
        match self {
            Self::Pactl(name) => format!("pactl:{name}"),
            Self::Wpctl => "wpctl".to_owned(),
        }
    }
}

pub(crate) fn mute_output() -> Option<Sink> {
    [Sink::default_pactl(), Sink::Wpctl]
        .into_iter()
        .find(|sink| mute::Mute::muted(sink).is_some())
}

pub(crate) fn recorded_mute_output(record: &records::Muted) -> Option<Sink> {
    Sink::from_id(&record.output)
}

pub(crate) fn duck_output() -> Option<Sink> {
    [Sink::default_pactl(), Sink::Wpctl]
        .into_iter()
        .find(|sink| ramp::Volume::read(sink).is_some())
}

pub(crate) fn recorded_duck_output(id: &str) -> Option<Sink> {
    Sink::from_id(id)
}

impl mute::Mute for Sink {
    fn muted(&self) -> Option<bool> {
        match self {
            Self::Pactl(name) => parse_pactl_mute(&run("pactl", &["get-sink-mute", name])?),
            Self::Wpctl => {
                let output = run("wpctl", &["get-volume", WPCTL_SINK])?;
                parse_wpctl_volume(&output).map(|_| output.contains("[MUTED]"))
            }
        }
    }

    fn set_muted(&mut self, muted: bool) -> bool {
        let value = if muted { "1" } else { "0" };
        match self {
            Self::Pactl(name) => run("pactl", &["set-sink-mute", name, value]),
            Self::Wpctl => run("wpctl", &["set-mute", WPCTL_SINK, value]),
        }
        .is_some()
    }

    fn record(&self) -> records::Muted {
        records::Muted {
            output: self.id(),
            previous_volume: None,
        }
    }
}

impl ramp::Volume for Sink {
    /// Each channel through `pactl`, which keeps the balance; `wpctl`
    /// reports one volume.
    fn read(&self) -> Option<Vec<f32>> {
        match self {
            Self::Pactl(name) => parse_pactl_volume(&run("pactl", &["get-sink-volume", name])?),
            Self::Wpctl => parse_wpctl_volume(&run("wpctl", &["get-volume", WPCTL_SINK])?)
                .map(|volume| vec![volume]),
        }
    }

    fn write(&mut self, values: &[f32]) -> bool {
        match self {
            Self::Pactl(name) => {
                let raw: Vec<_> = values
                    .iter()
                    .map(|value| ((value * PA_VOLUME_NORM).round() as u32).to_string())
                    .collect();
                let mut args = vec!["set-sink-volume", name.as_str()];
                args.extend(raw.iter().map(String::as_str));
                run("pactl", &args).is_some()
            }
            Self::Wpctl => values.first().is_some_and(|value| {
                run("wpctl", &["set-volume", WPCTL_SINK, &format!("{value:.4}")]).is_some()
            }),
        }
    }

    fn id(&self) -> String {
        Sink::id(self)
    }
}

fn run(program: &str, args: &[&str]) -> Option<String> {
    // The C locale keeps pactl's "Mute: yes" and volume lines untranslated.
    let output = Command::new(program)
        .args(args)
        .env("LC_ALL", "C")
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

fn parse_pactl_mute(output: &str) -> Option<bool> {
    match output.trim().strip_prefix("Mute:")?.trim() {
        "yes" => Some(true),
        "no" => Some(false),
        _ => None,
    }
}

/// Each channel's raw volume from `pactl get-sink-volume`, such as
/// `Volume: front-left: 32768 /  50% / -18.06 dB,   front-right: ...`.
fn parse_pactl_volume(output: &str) -> Option<Vec<f32>> {
    let line = output
        .lines()
        .find(|line| line.trim_start().starts_with("Volume:"))?;
    let values = line
        .trim_start()
        .trim_start_matches("Volume:")
        .split(',')
        .map(|channel| {
            let (_, rest) = channel.split_once(':')?;
            let raw: u32 = rest.split('/').next()?.trim().parse().ok()?;
            Some(raw as f32 / PA_VOLUME_NORM)
        })
        .collect::<Option<Vec<_>>>()?;
    (!values.is_empty()).then_some(values)
}

/// The volume from `wpctl get-volume`, such as `Volume: 0.47 [MUTED]`.
fn parse_wpctl_volume(output: &str) -> Option<f32> {
    output
        .trim()
        .strip_prefix("Volume:")?
        .split_whitespace()
        .next()?
        .parse()
        .ok()
        .filter(|volume: &f32| volume.is_finite() && *volume >= 0.0)
}

/// MPRIS players on the session bus. Browsers publish their tabs' media
/// here too, so they need no separate handling.
struct Mpris {
    runtime: tokio::runtime::Runtime,
    bus: Connection,
}

impl Mpris {
    fn connect() -> Option<Self> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .inspect_err(|error| tracing::warn!(%error, "cannot start the D-Bus runtime"))
            .ok()?;
        let bus = runtime
            .block_on(async { tokio::time::timeout(DBUS_TIMEOUT, Connection::session()).await })
            .map_err(|_| "the session D-Bus did not answer".to_owned())
            .and_then(|bus| bus.map_err(|error| error.to_string()))
            .inspect_err(|error| tracing::warn!(%error, "cannot reach the session D-Bus"))
            .ok()?;
        Some(Self { runtime, bus })
    }

    fn call<B>(
        &self,
        destination: &str,
        path: &str,
        interface: &str,
        method: &str,
        body: &B,
    ) -> Option<zbus::Message>
    where
        B: serde::Serialize + zbus::zvariant::DynamicType,
    {
        self.runtime.block_on(async {
            let call = self
                .bus
                .call_method(Some(destination), path, Some(interface), method, body);
            tokio::time::timeout(DBUS_TIMEOUT, call).await.ok()?.ok()
        })
    }

    fn playback_status(&self, name: &str) -> Option<String> {
        let reply = self.call(
            name,
            MPRIS_PATH,
            "org.freedesktop.DBus.Properties",
            "Get",
            &(MPRIS_PLAYER, "PlaybackStatus"),
        )?;
        let status: OwnedValue = reply.body().deserialize().ok()?;
        String::try_from(status).ok()
    }
}

impl Players for Mpris {
    type Player = String;

    fn playing(&mut self) -> Vec<String> {
        let names: Vec<String> = self
            .call(
                "org.freedesktop.DBus",
                "/org/freedesktop/DBus",
                "org.freedesktop.DBus",
                "ListNames",
                &(),
            )
            .and_then(|reply| reply.body().deserialize().ok())
            .unwrap_or_default();
        names
            .into_iter()
            .filter(|name| {
                name.starts_with(MPRIS_PREFIX)
                    && self.playback_status(name).as_deref() == Some("Playing")
            })
            .collect()
    }

    fn pause(&mut self, name: &String) -> bool {
        self.call(name, MPRIS_PATH, MPRIS_PLAYER, "Pause", &())
            .is_some()
    }

    fn paused(&mut self, name: &String) -> bool {
        self.playback_status(name).as_deref() == Some("Paused")
    }

    fn play(&mut self, name: &String) -> bool {
        self.call(name, MPRIS_PATH, MPRIS_PLAYER, "Play", &())
            .is_some()
    }
}

/// Players paused for dictation, resumed on drop.
pub(crate) struct Paused(Vec<String>);

impl Drop for Paused {
    fn drop(&mut self) {
        if let Some(mut players) = Mpris::connect() {
            media::resume(&mut players, &self.0);
        }
    }
}

/// Every Linux player reports its state, so `browsers` changes nothing.
pub(crate) fn pause_media(_browsers: bool) -> Option<Paused> {
    let paused = media::pause_playing(&mut Mpris::connect()?);
    if paused.is_empty() {
        return None;
    }
    tracing::info!(players = ?paused, "paused media for dictation");
    Some(Paused(paused))
}

/// logind keeps the inhibitor while this descriptor is open.
pub(crate) struct Awake {
    _inhibitor: OwnedFd,
}

impl Awake {
    /// Blocks idle and sleep, or only idle where polkit refuses to let a
    /// process outside the active seat session block sleep.
    pub(crate) fn start() -> std::io::Result<Self> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        runtime.block_on(async {
            let bus = tokio::time::timeout(DBUS_TIMEOUT, Connection::system())
                .await
                .map_err(|_| std::io::Error::other("the system D-Bus did not answer"))?
                .map_err(std::io::Error::other)?;
            match inhibit(&bus, "idle:sleep").await {
                Ok(awake) => Ok(awake),
                Err(error) => {
                    tracing::debug!(%error, "logind refused to block sleep; blocking idle only");
                    inhibit(&bus, "idle").await
                }
            }
        })
    }
}

async fn inhibit(bus: &Connection, what: &str) -> std::io::Result<Awake> {
    let body = (what, "Librelog", "Dictating", "block");
    let call = bus.call_method(
        Some("org.freedesktop.login1"),
        "/org/freedesktop/login1",
        Some("org.freedesktop.login1.Manager"),
        "Inhibit",
        &body,
    );
    let reply = tokio::time::timeout(DBUS_TIMEOUT, call)
        .await
        .map_err(|_| std::io::Error::other("logind did not answer"))?
        .map_err(std::io::Error::other)?;
    let inhibitor: OwnedFd = reply.body().deserialize().map_err(std::io::Error::other)?;
    Ok(Awake {
        _inhibitor: inhibitor,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sink_volume_and_mute_output_parse() {
        assert_eq!(
            parse_pactl_volume(
                "Volume: front-left: 32768 /  50% / -18.06 dB,   front-right: 65536 / 100% / 0.00 dB\n        balance 0.00\n"
            ),
            Some(vec![0.5, 1.0])
        );
        assert_eq!(parse_pactl_volume("Connection failure"), None);
        assert_eq!(parse_wpctl_volume("Volume: 0.25 [MUTED]\n"), Some(0.25));
        assert_eq!(parse_pactl_mute("Mute: yes\n"), Some(true));
        assert_eq!(parse_pactl_mute("Mute: no\n"), Some(false));
    }
}
