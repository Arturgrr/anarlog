//! Windows: the default render endpoint's volume and mute through WASAPI,
//! media through the system media transport controls (as Hex pauses it), and
//! a power request against idle sleep (as Hex keeps the computer awake).
//!
//! Hex lowers and mutes every other app's audio session instead, which
//! leaves its own sounds audible but misses sessions that start while
//! dictating; the endpoint matches what macOS and Linux change and can be
//! found again after a crash by its ID.

use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession, GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, eMultimedia, eRender,
};
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
};
use windows::Win32::System::Power::{
    PowerClearRequest, PowerCreateRequest, PowerRequestSystemRequired, PowerSetRequest,
};
use windows::Win32::System::Threading::{
    POWER_REQUEST_CONTEXT_SIMPLE_STRING, REASON_CONTEXT, REASON_CONTEXT_0,
};
use windows::core::{HSTRING, PWSTR};

use crate::media::{self, Players};
use crate::{mute, ramp, records};

/// The worker and each ramp use COM from their own thread. The apartment
/// is released when the thread ends.
pub(crate) fn init_thread() {
    // SAFETY: Called once at the start of a thread this crate owns.
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
}

/// The default render endpoint, held by its device ID.
pub(crate) struct Endpoint {
    id: String,
    volume: IAudioEndpointVolume,
}

pub(crate) type MuteOutput = Endpoint;

impl Endpoint {
    fn open(
        device: impl FnOnce(&IMMDeviceEnumerator) -> windows::core::Result<IMMDevice>,
    ) -> Option<Self> {
        let opened = (|| -> windows::core::Result<Self> {
            // SAFETY: COM is initialized on this thread; every call is checked.
            unsafe {
                let enumerator: IMMDeviceEnumerator =
                    CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
                let device = device(&enumerator)?;
                let raw: PWSTR = device.GetId()?;
                let id = raw.to_string();
                CoTaskMemFree(Some(raw.0.cast_const().cast()));
                Ok(Self {
                    id: id.map_err(|_| windows::core::Error::empty())?,
                    volume: device.Activate(CLSCTX_ALL, None)?,
                })
            }
        })();
        opened
            .inspect_err(|error| tracing::warn!(%error, "could not open the audio output"))
            .ok()
    }

    fn current() -> Option<Self> {
        // SAFETY: A plain query of the default output.
        Self::open(|enumerator| unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) })
    }

    fn with_id(id: &str) -> Option<Self> {
        // SAFETY: A plain query of a device by ID.
        Self::open(|enumerator| unsafe { enumerator.GetDevice(&HSTRING::from(id)) })
    }
}

pub(crate) fn mute_output() -> Option<Endpoint> {
    Endpoint::current()
}

pub(crate) fn recorded_mute_output(record: &records::Muted) -> Option<Endpoint> {
    Endpoint::with_id(&record.output)
}

pub(crate) fn duck_output() -> Option<Endpoint> {
    Endpoint::current()
}

pub(crate) fn recorded_duck_output(id: &str) -> Option<Endpoint> {
    Endpoint::with_id(id)
}

impl mute::Mute for Endpoint {
    fn muted(&self) -> Option<bool> {
        // SAFETY: A plain query of a live endpoint.
        unsafe { self.volume.GetMute() }
            .ok()
            .map(|muted| muted.as_bool())
    }

    fn set_muted(&mut self, muted: bool) -> bool {
        // SAFETY: A plain change of a live endpoint, without event context.
        unsafe { self.volume.SetMute(muted, std::ptr::null()) }.is_ok()
    }

    fn record(&self) -> records::Muted {
        records::Muted {
            output: self.id.clone(),
            previous_volume: None,
        }
    }
}

impl ramp::Volume for Endpoint {
    /// Each channel's own volume, which keeps the balance.
    fn read(&self) -> Option<Vec<f32>> {
        // SAFETY: Plain queries of a live endpoint.
        unsafe {
            let channels = self.volume.GetChannelCount().ok()?;
            (0..channels)
                .map(|channel| self.volume.GetChannelVolumeLevelScalar(channel).ok())
                .collect()
        }
    }

    fn write(&mut self, values: &[f32]) -> bool {
        values
            .iter()
            .zip(0..)
            .fold(true, |written, (&value, channel)| {
                // SAFETY: A plain change of a live endpoint, without event context.
                let result = unsafe {
                    self.volume.SetChannelVolumeLevelScalar(
                        channel,
                        value.clamp(0.0, 1.0),
                        std::ptr::null(),
                    )
                };
                written & result.is_ok()
            })
    }

    fn id(&self) -> String {
        self.id.clone()
    }
}

/// Every app that shows in Windows' media flyout, browser tabs included.
struct Transport {
    manager: Option<GlobalSystemMediaTransportControlsSessionManager>,
}

fn status(session: &GlobalSystemMediaTransportControlsSession) -> Option<PlaybackStatus> {
    session
        .GetPlaybackInfo()
        .and_then(|info| info.PlaybackStatus())
        .ok()
}

impl Players for Transport {
    type Player = GlobalSystemMediaTransportControlsSession;

    fn playing(&mut self) -> Vec<Self::Player> {
        let sessions = self
            .manager
            .as_ref()
            .map(|manager| manager.GetSessions())
            .transpose()
            .inspect_err(|error| tracing::warn!(%error, "could not list media sessions"))
            .ok()
            .flatten();
        sessions
            .into_iter()
            .flatten()
            .filter(|session| status(session) == Some(PlaybackStatus::Playing))
            .collect()
    }

    fn pause(&mut self, session: &Self::Player) -> bool {
        session
            .TryPauseAsync()
            .and_then(|operation| operation.join())
            .unwrap_or(false)
    }

    fn paused(&mut self, session: &Self::Player) -> bool {
        status(session) == Some(PlaybackStatus::Paused)
    }

    fn play(&mut self, session: &Self::Player) -> bool {
        session
            .TryPlayAsync()
            .and_then(|operation| operation.join())
            .unwrap_or(false)
    }
}

/// Media sessions paused for dictation, resumed on drop.
pub(crate) struct Paused(Vec<GlobalSystemMediaTransportControlsSession>);

impl Drop for Paused {
    fn drop(&mut self) {
        media::resume(&mut Transport { manager: None }, &self.0);
    }
}

/// Browsers report their tabs like any other player, so `browsers`
/// changes nothing.
pub(crate) fn pause_media(_browsers: bool) -> Option<Paused> {
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .and_then(|operation| operation.join())
        .inspect_err(|error| tracing::warn!(%error, "could not reach the media controls"))
        .ok()?;
    let paused = media::pause_playing(&mut Transport {
        manager: Some(manager),
    });
    if paused.is_empty() {
        return None;
    }
    tracing::info!(sessions = paused.len(), "paused media for dictation");
    Some(Paused(paused))
}

/// A system-required power request. Unlike `SetThreadExecutionState`, it
/// is not tied to the thread that made it.
pub(crate) struct Awake {
    request: HANDLE,
}

impl Awake {
    pub(crate) fn start() -> std::io::Result<Self> {
        let mut reason: Vec<u16> = "Librelog is dictating".encode_utf16().chain([0]).collect();
        let context = REASON_CONTEXT {
            Version: 0,
            Flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING,
            Reason: REASON_CONTEXT_0 {
                SimpleReasonString: PWSTR(reason.as_mut_ptr()),
            },
        };
        // SAFETY: `context` and its string outlive the call, which copies them.
        let request = unsafe { PowerCreateRequest(&context) }.map_err(std::io::Error::other)?;
        // SAFETY: `request` is the valid handle just created.
        if let Err(error) = unsafe { PowerSetRequest(request, PowerRequestSystemRequired) } {
            // SAFETY: The handle is ours and closed once.
            let _ = unsafe { CloseHandle(request) };
            return Err(std::io::Error::other(error));
        }
        Ok(Self { request })
    }
}

impl Drop for Awake {
    fn drop(&mut self) {
        // SAFETY: The request was set in `start`, and this guard closes it once.
        unsafe {
            let _ = PowerClearRequest(self.request, PowerRequestSystemRequired);
            let _ = CloseHandle(self.request);
        }
    }
}
