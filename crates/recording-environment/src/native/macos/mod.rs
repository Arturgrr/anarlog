//! macOS, adapted from Hex's recording environment: the default output
//! device through CoreAudio, media players through AppleScript once
//! Automation allows it, a browser through its own output (with
//! `macos-private-api`), and an IOKit assertion against idle sleep.

use std::collections::HashSet;
use std::ffi::c_void;
use std::mem::{offset_of, size_of};
use std::process::Command;
use std::ptr::NonNull;

use objc2_app_kit::NSWorkspace;
use objc2_core_audio::{
    AudioObjectGetPropertyData, AudioObjectGetPropertyDataSize, AudioObjectID,
    AudioObjectIsPropertySettable, AudioObjectPropertyAddress, AudioObjectSetPropertyData,
    kAudioDevicePropertyDeviceUID, kAudioDevicePropertyMute,
    kAudioDevicePropertyStreamConfiguration, kAudioDevicePropertyVolumeScalar,
    kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyTranslateUIDToDevice,
    kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyScopeOutput, kAudioObjectSystemObject,
};
use objc2_core_audio_types::{AudioBuffer, AudioBufferList};
use objc2_core_foundation::{CFRetained, CFString};

use crate::automation::{self, Automation};
use crate::{MediaControl, PlayerControl, mute, ramp, records};

#[cfg(feature = "macos-private-api")]
mod browser;

/// `kAudioHardwareServiceDeviceProperty_VirtualMainVolume`: the volume the
/// menu bar shows, also for devices without a volume control of their own.
const VIRTUAL_MAIN_VOLUME: u32 = u32::from_be_bytes(*b"vmvc");
const SILENT: f32 = 0.001;

pub(crate) fn init_thread() {}

fn address(selector: u32, scope: u32, element: u32) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress {
        mSelector: selector,
        mScope: scope,
        mElement: element,
    }
}

fn output_address(selector: u32, element: u32) -> AudioObjectPropertyAddress {
    address(selector, kAudioObjectPropertyScopeOutput, element)
}

fn read_with<T: Copy + Default>(
    object: AudioObjectID,
    mut address: AudioObjectPropertyAddress,
    qualifier: Option<(NonNull<c_void>, u32)>,
) -> Option<T> {
    let mut size = size_of::<T>() as u32;
    let mut value = T::default();
    let (qualifier, qualifier_size) = qualifier.map_or((std::ptr::null(), 0), |(data, size)| {
        (data.as_ptr().cast_const(), size)
    });
    // SAFETY: Every pointer refers to initialized, correctly sized values
    // that outlive the call.
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            NonNull::from(&mut address),
            qualifier_size,
            qualifier,
            NonNull::from(&mut size),
            NonNull::from(&mut value).cast::<c_void>(),
        )
    };
    (status == 0 && size as usize == size_of::<T>()).then_some(value)
}

fn read<T: Copy + Default>(
    object: AudioObjectID,
    address: AudioObjectPropertyAddress,
) -> Option<T> {
    read_with(object, address, None)
}

fn write<T: Copy>(
    object: AudioObjectID,
    mut address: AudioObjectPropertyAddress,
    value: T,
) -> bool {
    let mut value = value;
    // SAFETY: Every pointer refers to initialized, correctly sized values.
    unsafe {
        AudioObjectSetPropertyData(
            object,
            NonNull::from(&mut address),
            0,
            std::ptr::null(),
            size_of::<T>() as u32,
            NonNull::from(&mut value).cast::<c_void>(),
        ) == 0
    }
}

fn settable(object: AudioObjectID, mut address: AudioObjectPropertyAddress) -> bool {
    let mut settable = 0;
    // SAFETY: Both pointers refer to initialized, correctly typed values.
    unsafe {
        AudioObjectIsPropertySettable(
            object,
            NonNull::from(&mut address),
            NonNull::from(&mut settable),
        ) == 0
            && settable != 0
    }
}

/// A property's whole value and its size in bytes, such as a list of
/// objects.
fn read_bytes(
    object: AudioObjectID,
    mut address: AudioObjectPropertyAddress,
) -> Option<(Vec<u64>, usize)> {
    let mut bytes = 0;
    // SAFETY: The address and size point to initialized stack values.
    if unsafe {
        AudioObjectGetPropertyDataSize(
            object,
            NonNull::from(&mut address),
            0,
            std::ptr::null(),
            NonNull::from(&mut bytes),
        )
    } != 0
        || bytes > 1 << 20
    {
        return None;
    }
    // u64 storage gives any property struct and its pointers their alignment.
    let mut storage = vec![0u64; (bytes as usize).div_ceil(8).max(1)];
    // SAFETY: Storage is aligned and at least as large as CoreAudio reported.
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            NonNull::from(&mut address),
            0,
            std::ptr::null(),
            NonNull::from(&mut bytes),
            NonNull::new(storage.as_mut_ptr())?.cast(),
        )
    };
    if status != 0 || bytes as usize > storage.len() * size_of::<u64>() {
        return None;
    }
    Some((storage, bytes as usize))
}

/// A property that is a retained CFString.
fn read_string(object: AudioObjectID, selector: u32) -> Option<String> {
    let raw = read::<Option<NonNull<CFString>>>(
        object,
        address(
            selector,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain,
        ),
    )??;
    // SAFETY: CoreAudio returns string properties retained for the caller.
    let string = unsafe { CFRetained::from_raw(raw) };
    Some(string.to_string()).filter(|string| !string.is_empty())
}

fn default_output() -> Option<AudioObjectID> {
    read::<AudioObjectID>(
        kAudioObjectSystemObject as AudioObjectID,
        address(
            kAudioHardwarePropertyDefaultOutputDevice,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain,
        ),
    )
    .filter(|&device| device != 0)
}

/// The device's UID, which, unlike its object ID, survives a restart of the
/// audio server or the computer.
fn device_uid(device: AudioObjectID) -> Option<String> {
    read_string(device, kAudioDevicePropertyDeviceUID)
}

fn device_with_uid(uid: &str) -> Option<AudioObjectID> {
    let uid = CFString::from_str(uid);
    let uid_ref: *const CFString = &*uid;
    read_with::<AudioObjectID>(
        kAudioObjectSystemObject as AudioObjectID,
        address(
            kAudioHardwarePropertyTranslateUIDToDevice,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain,
        ),
        Some((
            NonNull::from(&uid_ref).cast(),
            size_of::<*const CFString>() as u32,
        )),
    )
    .filter(|&device| device != 0)
}

pub(crate) struct MuteOutput {
    device: AudioObjectID,
    uid: String,
    muting: Muting,
}

enum Muting {
    /// The device's own mute control.
    Control,
    /// Devices without one, such as many HDMI outputs, as Hex mutes every
    /// output: a zero volume, restored to `previous`.
    Volume { previous: f32 },
}

impl MuteOutput {
    fn on(device: AudioObjectID, uid: String, previous: Option<f32>) -> Option<Self> {
        let muting = match previous {
            Some(previous) => Muting::Volume { previous },
            None if settable(device, mute_address()) => Muting::Control,
            None if settable(device, virtual_main_address()) => Muting::Volume {
                previous: read::<f32>(device, virtual_main_address())
                    .filter(|volume| volume.is_finite())?,
            },
            None => return None,
        };
        Some(Self {
            device,
            uid,
            muting,
        })
    }
}

fn mute_address() -> AudioObjectPropertyAddress {
    output_address(kAudioDevicePropertyMute, kAudioObjectPropertyElementMain)
}

fn virtual_main_address() -> AudioObjectPropertyAddress {
    output_address(VIRTUAL_MAIN_VOLUME, kAudioObjectPropertyElementMain)
}

pub(crate) fn mute_output() -> Option<MuteOutput> {
    let device = default_output()?;
    MuteOutput::on(device, device_uid(device)?, None)
}

pub(crate) fn recorded_mute_output(record: &records::Muted) -> Option<MuteOutput> {
    MuteOutput::on(
        device_with_uid(&record.output)?,
        record.output.clone(),
        record.previous_volume,
    )
}

impl mute::Mute for MuteOutput {
    fn muted(&self) -> Option<bool> {
        match self.muting {
            Muting::Control => read::<u32>(self.device, mute_address()).map(|muted| muted != 0),
            Muting::Volume { .. } => {
                read::<f32>(self.device, virtual_main_address()).map(|volume| volume <= SILENT)
            }
        }
    }

    fn set_muted(&mut self, muted: bool) -> bool {
        match self.muting {
            Muting::Control => write(self.device, mute_address(), u32::from(muted)),
            Muting::Volume { previous } => write(
                self.device,
                virtual_main_address(),
                if muted { 0.0_f32 } else { previous },
            ),
        }
    }

    fn record(&self) -> records::Muted {
        records::Muted {
            output: self.uid.clone(),
            previous_volume: match self.muting {
                Muting::Control => None,
                Muting::Volume { previous } => Some(previous),
            },
        }
    }
}

/// The volumes "Lower audio" ramps: each output channel's own, else the
/// device's main volume, else the virtual main volume.
pub(crate) struct DuckOutput {
    device: AudioObjectID,
    uid: String,
    selector: u32,
    elements: Vec<u32>,
}

pub(crate) fn duck_output() -> Option<DuckOutput> {
    let device = default_output()?;
    DuckOutput::on(device, device_uid(device)?)
}

pub(crate) fn recorded_duck_output(uid: &str) -> Option<DuckOutput> {
    DuckOutput::on(device_with_uid(uid)?, uid.to_owned())
}

impl DuckOutput {
    fn on(device: AudioObjectID, uid: String) -> Option<Self> {
        let channels = output_channels(device).unwrap_or(0);
        let separate = Self {
            device,
            uid: uid.clone(),
            selector: kAudioDevicePropertyVolumeScalar,
            elements: (1..=channels).collect(),
        };
        if channels > 0 && separate.writable() && ramp::Volume::read(&separate).is_some() {
            return Some(separate);
        }
        // One volume written over channels that read apart would lose a
        // balance that cannot be restored channel by channel.
        if separate.elements.iter().any(|&element| {
            read::<f32>(
                device,
                output_address(kAudioDevicePropertyVolumeScalar, element),
            )
            .is_some()
        }) {
            return None;
        }
        [kAudioDevicePropertyVolumeScalar, VIRTUAL_MAIN_VOLUME]
            .into_iter()
            .map(|selector| Self {
                device,
                uid: uid.clone(),
                selector,
                elements: vec![kAudioObjectPropertyElementMain],
            })
            .find(|output| output.writable() && ramp::Volume::read(output).is_some())
    }

    fn writable(&self) -> bool {
        self.elements
            .iter()
            .all(|&element| settable(self.device, output_address(self.selector, element)))
    }
}

impl ramp::Volume for DuckOutput {
    fn read(&self) -> Option<Vec<f32>> {
        self.elements
            .iter()
            .map(|&element| {
                read::<f32>(self.device, output_address(self.selector, element))
                    .filter(|volume| volume.is_finite() && (0.0..=1.0).contains(volume))
            })
            .collect()
    }

    fn write(&mut self, values: &[f32]) -> bool {
        let mut written = true;
        for (&element, &value) in self.elements.iter().zip(values) {
            written &= write(
                self.device,
                output_address(self.selector, element),
                value.clamp(0.0, 1.0),
            );
        }
        written
    }

    fn id(&self) -> String {
        self.uid.clone()
    }
}

/// How many output channels the device's streams carry.
fn output_channels(device: AudioObjectID) -> Option<u32> {
    let (storage, bytes) = read_bytes(
        device,
        output_address(kAudioDevicePropertyStreamConfiguration, 0),
    )?;
    if bytes < size_of::<AudioBufferList>() {
        return None;
    }
    // SAFETY: The successful read initialized the header within storage.
    let count = unsafe { (*storage.as_ptr().cast::<AudioBufferList>()).mNumberBuffers } as usize;
    let offset = offset_of!(AudioBufferList, mBuffers);
    if offset + count.checked_mul(size_of::<AudioBuffer>())? > bytes {
        return None;
    }
    // SAFETY: The bounds above cover every buffer, and the offset keeps alignment.
    let buffers = unsafe {
        std::slice::from_raw_parts(
            storage
                .as_ptr()
                .cast::<u8>()
                .add(offset)
                .cast::<AudioBuffer>(),
            count,
        )
    };
    buffers
        .iter()
        .try_fold(0u32, |sum, buffer| sum.checked_add(buffer.mNumberChannels))
        .filter(|&channels| channels <= 256)
}

/// A media player that may be paused while dictating and resumed after.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum MediaPlayer {
    Music,
    Spotify,
    Vlc,
}

impl MediaPlayer {
    const ALL: [Self; 3] = [Self::Music, Self::Spotify, Self::Vlc];

    fn name(self) -> &'static str {
        match self {
            Self::Music => "Music",
            Self::Spotify => "Spotify",
            Self::Vlc => "VLC",
        }
    }

    fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|player| player.name() == name)
    }

    fn bundle_id(self) -> &'static str {
        match self {
            Self::Music => "com.apple.Music",
            Self::Spotify => "com.spotify.client",
            Self::Vlc => "org.videolan.vlc",
        }
    }

    fn from_bundle_id(bundle_id: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|player| player.bundle_id() == bundle_id)
    }

    fn playing_clause(self) -> &'static str {
        match self {
            Self::Music | Self::Spotify => "player state is playing",
            Self::Vlc => "playing",
        }
    }

    /// VLC tells only whether it plays, so a VLC stopped meanwhile plays too.
    fn paused_clause(self) -> &'static str {
        match self {
            Self::Music | Self::Spotify => "player state is paused",
            Self::Vlc => "not playing",
        }
    }

    fn pause_fragment(self) -> String {
        let name = self.name();
        let playing = self.playing_clause();
        format!(
            "\ntry\n  if application \"{name}\" is running then\n    tell application \"{name}\"\n      if {playing} then\n        pause\n        set end of pausedPlayers to \"{name}\"\n      end if\n    end tell\n  end if\nend try\n"
        )
    }

    fn resume_fragment(self) -> String {
        let name = self.name();
        let paused = self.paused_clause();
        format!(
            "\ntry\n  if application \"{name}\" is running then\n    tell application \"{name}\"\n      if {paused} then play\n    end tell\n  end if\nend try\n"
        )
    }
}

/// Telling a player that is not installed fails the whole script, so only
/// running players are named.
fn running_players() -> HashSet<MediaPlayer> {
    objc2::rc::autoreleasepool(|_| {
        NSWorkspace::sharedWorkspace()
            .runningApplications()
            .iter()
            .filter_map(|application| {
                MediaPlayer::from_bundle_id(&application.bundleIdentifier()?.to_string())
            })
            .collect()
    })
}

fn osascript(script: &str) -> Option<String> {
    let output = Command::new("/usr/bin/osascript")
        .args(["-e", script])
        .output()
        .inspect_err(|error| tracing::warn!(%error, "could not run AppleScript"))
        .ok()?;
    if !output.status.success() {
        tracing::warn!(
            error = %String::from_utf8_lossy(&output.stderr).trim(),
            "AppleScript could not control a media player"
        );
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// `AEDesc`, which AEDataModel.h packs to two bytes.
#[repr(C, packed(2))]
struct AeDesc {
    descriptor_type: u32,
    data_handle: *mut c_void,
}

const TYPE_APPLICATION_BUNDLE_ID: u32 = u32::from_be_bytes(*b"bund");
const TYPE_WILD_CARD: u32 = u32::from_be_bytes(*b"****");
const PROC_NOT_FOUND: i32 = -600;
const ERR_AE_EVENT_NOT_PERMITTED: i32 = -1743;
const ERR_AE_EVENT_WOULD_REQUIRE_USER_CONSENT: i32 = -1744;

/// Automation consent to send `player` Apple events. With `ask`, macOS
/// prompts if it has not asked yet, and this blocks until the answer.
fn automation_consent(player: MediaPlayer, ask: bool) -> MediaControl {
    let bundle_id = player.bundle_id();
    let mut target = AeDesc {
        descriptor_type: 0,
        data_handle: std::ptr::null_mut(),
    };
    // SAFETY: The bundle ID's bytes outlive the call, which copies them into
    // `target`, a writable descriptor.
    if unsafe {
        AECreateDesc(
            TYPE_APPLICATION_BUNDLE_ID,
            bundle_id.as_ptr().cast(),
            bundle_id.len() as isize,
            &mut target,
        )
    } != 0
    {
        return MediaControl::NotDetermined;
    }
    // SAFETY: `target` is the address descriptor created above.
    let status = unsafe {
        AEDeterminePermissionToAutomateTarget(
            &target,
            TYPE_WILD_CARD,
            TYPE_WILD_CARD,
            u8::from(ask),
        )
    };
    // SAFETY: Disposes of the descriptor created above, once.
    unsafe { AEDisposeDesc(&mut target) };
    match status {
        0 => MediaControl::Allowed,
        ERR_AE_EVENT_NOT_PERMITTED => MediaControl::Denied,
        PROC_NOT_FOUND => MediaControl::NotRunning,
        ERR_AE_EVENT_WOULD_REQUIRE_USER_CONSENT => MediaControl::NotDetermined,
        status => {
            tracing::warn!(?player, status, "could not read Automation consent");
            MediaControl::NotDetermined
        }
    }
}

struct Players;

impl Automation for Players {
    type Player = MediaPlayer;

    fn running(&mut self) -> Vec<MediaPlayer> {
        let running = running_players();
        MediaPlayer::ALL
            .into_iter()
            .filter(|player| running.contains(player))
            .collect()
    }

    fn consent(&mut self, player: MediaPlayer, ask: bool) -> MediaControl {
        automation_consent(player, ask)
    }
}

pub(crate) fn request_media_control() -> Vec<PlayerControl> {
    automation::request(&mut Players, &MediaPlayer::ALL)
        .into_iter()
        .map(|(player, control)| PlayerControl {
            player: player.name().into(),
            control,
        })
        .collect()
}

fn pause_players() -> Vec<MediaPlayer> {
    // Asking for consent mid-dictation would hold the worker on a prompt.
    let players = automation::allowed(&mut Players);
    if players.is_empty() {
        return Vec::new();
    }
    let mut script = String::from("set pausedPlayers to {}\n");
    for player in players {
        script.push_str(&player.pause_fragment());
    }
    script.push_str("return pausedPlayers\n");
    osascript(&script)
        .map(|paused| {
            paused
                .split(',')
                .map(str::trim)
                .filter_map(MediaPlayer::from_name)
                .collect()
        })
        .unwrap_or_default()
}

fn resume_players(players: &[MediaPlayer]) {
    let running = running_players();
    let script: String = players
        .iter()
        .filter(|player| running.contains(player))
        .map(|player| player.resume_fragment())
        .collect();
    if !script.is_empty() && osascript(&script).is_some() {
        tracing::info!(?players, "resumed media after dictation");
    }
}

/// What was paused for dictation, resumed on drop.
pub(crate) struct Paused {
    players: Vec<MediaPlayer>,
    #[cfg(feature = "macos-private-api")]
    browser: Option<crate::browser::PausedBrowser>,
}

impl Drop for Paused {
    fn drop(&mut self) {
        // The browser first: its play goes to whatever macOS treats as
        // playing, which a player resumed just before could become.
        #[cfg(feature = "macos-private-api")]
        if let Some(paused) = self.browser.take() {
            browser::resume(paused);
        }
        resume_players(&self.players);
    }
}

pub(crate) fn pause_media(browsers: bool) -> Option<Paused> {
    let players = pause_players();
    if !players.is_empty() {
        tracing::info!(?players, "paused media for dictation");
    }
    #[cfg(feature = "macos-private-api")]
    let browser = browsers.then(browser::pause).flatten();
    #[cfg(not(feature = "macos-private-api"))]
    if browsers {
        tracing::debug!("pausing a browser needs the macos-private-api feature");
    }
    #[cfg(feature = "macos-private-api")]
    let nothing = players.is_empty() && browser.is_none();
    #[cfg(not(feature = "macos-private-api"))]
    let nothing = players.is_empty();
    (!nothing).then_some(Paused {
        players,
        #[cfg(feature = "macos-private-api")]
        browser,
    })
}

/// An IOKit assertion against idle sleep, released on drop.
pub(crate) struct Awake {
    assertion: u32,
}

impl Awake {
    pub(crate) fn start() -> std::io::Result<Self> {
        const ASSERTION_LEVEL_ON: u32 = 255;
        let kind = CFString::from_static_str("PreventUserIdleSystemSleep");
        let name = CFString::from_static_str("Librelog is dictating");
        let mut assertion = 0;
        // SAFETY: Both strings outlive the call and `assertion` is writable;
        // IOKit keeps the assertion until IOPMAssertionRelease.
        let status = unsafe {
            IOPMAssertionCreateWithName(
                (&*kind as *const CFString).cast(),
                ASSERTION_LEVEL_ON,
                (&*name as *const CFString).cast(),
                &mut assertion,
            )
        };
        if status != 0 {
            return Err(std::io::Error::other(format!(
                "IOPMAssertionCreateWithName failed with IOReturn 0x{:08x}",
                status as u32
            )));
        }
        Ok(Self { assertion })
    }
}

impl Drop for Awake {
    fn drop(&mut self) {
        // SAFETY: The assertion came from a successful create, and this
        // guard releases it once.
        let status = unsafe { IOPMAssertionRelease(self.assertion) };
        if status != 0 {
            tracing::warn!(
                status = format_args!("0x{:08x}", status as u32),
                "could not release the idle sleep assertion"
            );
        }
    }
}

#[link(name = "CoreServices", kind = "framework")]
unsafe extern "C" {
    fn AECreateDesc(type_code: u32, data: *const c_void, size: isize, result: *mut AeDesc) -> i16;
    fn AEDisposeDesc(desc: *mut AeDesc) -> i16;
    fn AEDeterminePermissionToAutomateTarget(
        target: *const AeDesc,
        event_class: u32,
        event_id: u32,
        ask_user_if_needed: u8,
    ) -> i32;
}

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOPMAssertionCreateWithName(
        assertion_type: *const c_void,
        assertion_level: u32,
        assertion_name: *const c_void,
        assertion_id: *mut u32,
    ) -> i32;
    fn IOPMAssertionRelease(assertion_id: u32) -> i32;
}
