//! The browsers' own output, heard through a private Core Audio process tap,
//! and the system's pause and play commands, ported from Hex. Both the
//! commands (MediaRemote) and the consent check (TCC) are private APIs.

use std::ffi::{CStr, c_void};
use std::mem::size_of;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{AnyThread, Message};
use objc2_app_kit::NSRunningApplication;
use objc2_core_audio::{
    AudioDeviceCreateIOProcIDWithBlock, AudioDeviceDestroyIOProcID, AudioDeviceIOProcID,
    AudioDeviceStart, AudioDeviceStop, AudioHardwareCreateAggregateDevice,
    AudioHardwareCreateProcessTap, AudioHardwareDestroyAggregateDevice,
    AudioHardwareDestroyProcessTap, AudioObjectID, CATapDescription, CATapMuteBehavior,
    kAudioAggregateDeviceIsPrivateKey, kAudioAggregateDeviceNameKey,
    kAudioAggregateDeviceTapAutoStartKey, kAudioAggregateDeviceTapListKey,
    kAudioAggregateDeviceUIDKey, kAudioHardwarePropertyProcessObjectList,
    kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject,
    kAudioProcessPropertyBundleID, kAudioProcessPropertyIsRunningInput,
    kAudioProcessPropertyIsRunningOutput, kAudioProcessPropertyPID, kAudioSubTapUIDKey,
};
use objc2_core_audio_types::{AudioBuffer, AudioBufferList, AudioTimeStamp};
use objc2_core_foundation::{CFDictionary, CFString};
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString};

use crate::browser::{self, BrowserAudio, MediaCommand, PausedBrowser};

/// How long a new tap may take to deliver its first cycle.
const TAP_WARM_UP: Duration = Duration::from_millis(300);

pub(super) fn pause() -> Option<PausedBrowser> {
    // A tap without consent opens the macOS prompt, which must never open
    // while dictating.
    if !system_audio_granted() {
        tracing::info!("left the browser alone: System Audio Recording is not allowed");
        return None;
    }
    browser::pause(&mut NativeBrowserAudio::new(Processes::Playing))
}

pub(super) fn resume(paused: PausedBrowser) {
    browser::resume(&mut NativeBrowserAudio::new(Processes::All), paused);
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Processes {
    /// Only those with open output: a closed output is silent, so most
    /// dictations open no tap at all.
    Playing,
    /// Every browser: a paused one closes its output a few seconds later.
    All,
}

/// Build one per pause or resume: the tap covers the browser processes
/// running when it first listens.
struct NativeBrowserAudio {
    processes: Processes,
    tap: Option<Tap>,
    started: bool,
}

impl NativeBrowserAudio {
    fn new(processes: Processes) -> Self {
        Self {
            processes,
            tap: None,
            started: false,
        }
    }
}

impl BrowserAudio for NativeBrowserAudio {
    fn in_call(&mut self) -> bool {
        browser_processes().is_none_or(|processes| processes.iter().any(|p| p.running_input))
    }

    fn peak_dbfs(&mut self, window: Duration) -> Option<f32> {
        if !self.started {
            self.started = true;
            self.tap = Tap::start(self.processes)
                .inspect_err(|error| tracing::warn!(%error, "could not listen to the browser"))
                .ok()
                .flatten();
        }
        self.tap.as_ref()?.peak_dbfs(window)
    }

    fn send(&mut self, command: MediaCommand) -> bool {
        send_media_command(command)
    }

    fn output_closed(&mut self) -> bool {
        // A browser that quit is not a paused one: play would reach another app.
        browser_processes().is_some_and(|processes| {
            !processes.is_empty()
                && processes
                    .iter()
                    .all(|process| process.running_output == Some(false))
        })
    }
}

struct BrowserProcess {
    object: AudioObjectID,
    running_input: bool,
    running_output: Option<bool>,
}

/// The Core Audio process objects of running browsers, this app excluded.
fn browser_processes() -> Option<Vec<BrowserProcess>> {
    let global = |selector| {
        super::address(
            selector,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain,
        )
    };
    let (storage, bytes) = super::read_bytes(
        kAudioObjectSystemObject as AudioObjectID,
        global(kAudioHardwarePropertyProcessObjectList),
    )?;
    // SAFETY: Storage holds `bytes` initialized bytes, aligned for u32.
    let objects = unsafe {
        std::slice::from_raw_parts(
            storage.as_ptr().cast::<AudioObjectID>(),
            bytes / size_of::<AudioObjectID>(),
        )
    };
    let own = std::process::id() as i32;
    let flag = |object, selector| super::read::<u32>(object, global(selector)).map(|v| v != 0);
    objc2::rc::autoreleasepool(|_| {
        Some(
            objects
                .iter()
                .filter_map(|&object| {
                    let pid = super::read::<i32>(object, global(kAudioProcessPropertyPID))?;
                    let bundle_id = super::read_string(object, kAudioProcessPropertyBundleID)?;
                    (pid != own && is_browser(&bundle_id, || application_name(pid))).then(|| {
                        BrowserProcess {
                            object,
                            running_input: flag(object, kAudioProcessPropertyIsRunningInput)
                                .unwrap_or(false),
                            running_output: flag(object, kAudioProcessPropertyIsRunningOutput),
                        }
                    })
                })
                .collect(),
        )
    })
}

fn application_name(pid: i32) -> Option<String> {
    NSRunningApplication::runningApplicationWithProcessIdentifier(pid)?
        .localizedName()
        .map(|name| name.to_string())
}

/// One of the known browsers, or one of their helper processes.
fn is_browser(bundle_id: &str, name: impl FnOnce() -> Option<String>) -> bool {
    const BROWSERS: [&str; 8] = [
        "com.google.chrome",
        "com.brave.browser",
        "com.apple.safari",
        "org.mozilla.firefox",
        "org.mozilla.plugincontainer",
        "com.microsoft.edgemac",
        "company.thebrowser.browser",
        "com.vivaldi.vivaldi",
    ];
    let bundle = bundle_id.to_ascii_lowercase();
    if bundle == "com.apple.webkit.gpu" {
        // Safari plays through a WebKit process told apart only by its name.
        return name().is_some_and(|name| name.to_ascii_lowercase().starts_with("safari"));
    }
    BROWSERS.iter().any(|browser| {
        bundle
            .strip_prefix(browser)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('.'))
    })
}

/// A private tap on the browsers' mixed-down output, read through a
/// private aggregate device.
struct Tap {
    tap: AudioObjectID,
    aggregate: AudioObjectID,
    io_proc: AudioDeviceIOProcID,
    /// The largest |sample| since the last reset, as f32 bits: non-negative
    /// floats order the same as their bits, so `fetch_max` keeps the peak.
    peak: Arc<AtomicU32>,
    callbacks: Arc<AtomicU64>,
}

impl Tap {
    /// None when no browser process matches.
    fn start(processes: Processes) -> Result<Option<Self>, String> {
        let objects: Vec<_> = browser_processes()
            .ok_or("could not list the browser processes")?
            .into_iter()
            .filter(|process| processes == Processes::All || process.running_output.unwrap_or(true))
            .map(|process| NSNumber::new_u32(process.object))
            .collect();
        if objects.is_empty() {
            return Ok(None);
        }
        let objects = NSArray::from_retained_slice(&objects);
        // SAFETY: Standard CATapDescription initialization and setters.
        let description = unsafe {
            let description =
                CATapDescription::initMonoMixdownOfProcesses(CATapDescription::alloc(), &objects);
            description.setName(&NSString::from_str("Librelog browser level"));
            description.setPrivate(true);
            description.setMuteBehavior(CATapMuteBehavior::Unmuted);
            description
        };
        let mut tap: AudioObjectID = 0;
        // SAFETY: `description` is a valid tap description; `tap` is writable.
        check(
            unsafe { AudioHardwareCreateProcessTap(Some(&description), &mut tap) },
            "could not create the browser audio tap",
        )?;
        let mut source = Self {
            tap,
            aggregate: 0,
            io_proc: None,
            peak: Arc::new(AtomicU32::new(0)),
            callbacks: Arc::new(AtomicU64::new(0)),
        };
        // SAFETY: Reading the UUID of a live description.
        let tap_uid = unsafe { description.UUID() }.UUIDString();
        source.aggregate = create_tap_aggregate(&tap_uid)?;
        let peak = source.peak.clone();
        let callbacks = source.callbacks.clone();
        let block = RcBlock::new(
            move |_now: NonNull<AudioTimeStamp>,
                  input: NonNull<AudioBufferList>,
                  _input_time: NonNull<AudioTimeStamp>,
                  _output: NonNull<AudioBufferList>,
                  _output_time: NonNull<AudioTimeStamp>| {
                // SAFETY: Core Audio passes a valid list of float buffers.
                let cycle_peak = unsafe { buffer_peak(input) };
                peak.fetch_max(cycle_peak.to_bits(), Ordering::Relaxed);
                callbacks.fetch_add(1, Ordering::Relaxed);
            },
        );
        let mut io_proc: AudioDeviceIOProcID = None;
        // SAFETY: The aggregate exists; Core Audio copies the block.
        check(
            unsafe {
                AudioDeviceCreateIOProcIDWithBlock(
                    NonNull::from(&mut io_proc),
                    source.aggregate,
                    None,
                    RcBlock::as_ptr(&block),
                )
            },
            "could not attach to the browser audio tap",
        )?;
        source.io_proc = io_proc;
        // SAFETY: Starting the IOProc created above.
        check(
            unsafe { AudioDeviceStart(source.aggregate, source.io_proc) },
            "could not start the browser audio tap",
        )?;
        let warm_up = Instant::now();
        while source.callbacks.load(Ordering::Relaxed) == 0 && warm_up.elapsed() < TAP_WARM_UP {
            std::thread::sleep(Duration::from_millis(10));
        }
        Ok(Some(source))
    }

    /// None when the tap delivered nothing during `window`.
    fn peak_dbfs(&self, window: Duration) -> Option<f32> {
        let callbacks = self.callbacks.load(Ordering::Relaxed);
        self.peak.store(0, Ordering::Relaxed);
        std::thread::sleep(window);
        if self.callbacks.load(Ordering::Relaxed) == callbacks {
            return None;
        }
        let peak = f32::from_bits(self.peak.load(Ordering::Relaxed));
        Some(if peak > 0.0 {
            20.0 * peak.log10()
        } else {
            -200.0
        })
    }
}

impl Drop for Tap {
    fn drop(&mut self) {
        // SAFETY: Each object was created by this tap and is torn down once,
        // in reverse order of creation.
        unsafe {
            if self.aggregate != 0 {
                if self.io_proc.is_some() {
                    AudioDeviceStop(self.aggregate, self.io_proc);
                    AudioDeviceDestroyIOProcID(self.aggregate, self.io_proc);
                }
                AudioHardwareDestroyAggregateDevice(self.aggregate);
            }
            if self.tap != 0 {
                AudioHardwareDestroyProcessTap(self.tap);
            }
        }
    }
}

fn object<T: Message>(value: Retained<T>) -> Retained<AnyObject> {
    // SAFETY: Every Objective-C object is an `AnyObject`.
    unsafe { Retained::cast_unchecked(value) }
}

/// A private aggregate device that reads one process tap.
fn create_tap_aggregate(tap_uid: &NSString) -> Result<AudioObjectID, String> {
    fn key(name: &CStr) -> Retained<NSString> {
        NSString::from_str(name.to_str().unwrap_or_default())
    }
    let sub_tap: Retained<NSDictionary<NSString, AnyObject>> = NSDictionary::from_retained_objects(
        &[&*key(kAudioSubTapUIDKey)],
        &[object(NSString::from_str(&tap_uid.to_string()))],
    );
    let taps = NSArray::from_retained_slice(&[sub_tap]);
    let description: Retained<NSDictionary<NSString, AnyObject>> =
        NSDictionary::from_retained_objects(
            &[
                &*key(kAudioAggregateDeviceNameKey),
                &*key(kAudioAggregateDeviceUIDKey),
                &*key(kAudioAggregateDeviceIsPrivateKey),
                &*key(kAudioAggregateDeviceTapAutoStartKey),
                &*key(kAudioAggregateDeviceTapListKey),
            ],
            &[
                object(NSString::from_str("Librelog Browser Level")),
                object(NSString::from_str(&format!(
                    "librelog.browser-tap.{}",
                    std::process::id()
                ))),
                object(NSNumber::new_bool(true)),
                object(NSNumber::new_bool(true)),
                object(taps),
            ],
        );
    let mut aggregate: AudioObjectID = 0;
    // SAFETY: NSDictionary is toll-free bridged to CFDictionary.
    let dictionary: &CFDictionary =
        unsafe { &*(Retained::as_ptr(&description) as *const CFDictionary) };
    check(
        // SAFETY: A valid description and a writable device ID.
        unsafe { AudioHardwareCreateAggregateDevice(dictionary, NonNull::from(&mut aggregate)) },
        "could not create the browser level device",
    )?;
    Ok(aggregate)
}

/// The largest |sample| in one IO cycle.
///
/// # Safety
/// `list` must point at a valid `AudioBufferList` of 32-bit float samples.
unsafe fn buffer_peak(list: NonNull<AudioBufferList>) -> f32 {
    // SAFETY: The caller passes a valid list.
    let list = unsafe { list.as_ref() };
    // SAFETY: A valid list holds `mNumberBuffers` buffers.
    let buffers: &[AudioBuffer] =
        unsafe { std::slice::from_raw_parts(list.mBuffers.as_ptr(), list.mNumberBuffers as usize) };
    buffers
        .iter()
        .filter(|buffer| !buffer.mData.is_null())
        .flat_map(|buffer| {
            let len = buffer.mDataByteSize as usize / size_of::<f32>();
            // SAFETY: Each buffer holds `mDataByteSize` bytes of floats.
            unsafe { std::slice::from_raw_parts(buffer.mData.cast::<f32>(), len) }
        })
        .fold(0.0, |peak: f32, sample| peak.max(sample.abs()))
}

fn check(status: i32, context: &str) -> Result<(), String> {
    if status == 0 {
        Ok(())
    } else {
        Err(format!("{context} (OSStatus {status})"))
    }
}

/// Opens a private framework once and resolves `symbol` in it.
fn private_symbol(framework: &CStr, symbol: &CStr) -> Option<*mut c_void> {
    // SAFETY: dlopen and dlsym with valid C strings; the result is checked.
    unsafe {
        let handle = libc::dlopen(framework.as_ptr(), libc::RTLD_LAZY);
        if handle.is_null() {
            return None;
        }
        let symbol = libc::dlsym(handle, symbol.as_ptr());
        (!symbol.is_null()).then_some(symbol)
    }
}

type TccPreflight = unsafe extern "C" fn(*const c_void, *const c_void) -> i32;

/// macOS "System Audio Recording" consent (TCC `kTCCServiceAudioCapture`),
/// which process taps need.
fn system_audio_granted() -> bool {
    static PREFLIGHT: OnceLock<Option<TccPreflight>> = OnceLock::new();
    let preflight = PREFLIGHT.get_or_init(|| {
        let symbol = private_symbol(
            c"/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC",
            c"TCCAccessPreflight",
        )?;
        // SAFETY: TCCAccessPreflight has this signature on every macOS that ships it.
        Some(unsafe { std::mem::transmute::<*mut c_void, TccPreflight>(symbol) })
    });
    let Some(preflight) = preflight else {
        return false;
    };
    let service = CFString::from_static_str("kTCCServiceAudioCapture");
    // SAFETY: A CFString service name and no options.
    unsafe { preflight((&*service as *const CFString).cast(), std::ptr::null()) == 0 }
}

type SendCommand = unsafe extern "C" fn(u32, *const c_void) -> bool;

/// `MRMediaRemoteSendCommand`: the same play and pause as the media keys,
/// sent to the app macOS has as Now Playing.
fn send_media_command(command: MediaCommand) -> bool {
    static SEND: OnceLock<Option<SendCommand>> = OnceLock::new();
    let send = SEND.get_or_init(|| {
        let symbol = private_symbol(
            c"/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote",
            c"MRMediaRemoteSendCommand",
        )?;
        // SAFETY: MRMediaRemoteSendCommand has this signature on every macOS
        // that ships the framework.
        Some(unsafe { std::mem::transmute::<*mut c_void, SendCommand>(symbol) })
    });
    let Some(send) = send else {
        tracing::warn!("MediaRemote is not available");
        return false;
    };
    let command = match command {
        MediaCommand::Play => 0,
        MediaCommand::Pause => 1,
    };
    // SAFETY: A command number and no options dictionary.
    unsafe { send(command, std::ptr::null()) }
}
