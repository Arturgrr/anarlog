//! transcribe.cpp's compute backends, registered once per process before any
//! model loads, and the state the device choice keeps: the preference, the
//! GPU failure record, and, on Windows, the marker that spans GPU start-up.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU8, Ordering};

use crate::gpu_health::{self, GpuHealth};
use crate::{DevicePreference, Error, SttDevice, SttDeviceKind};

struct State {
    health: GpuHealth,
    #[cfg_attr(not(windows), allow(dead_code))]
    state_dir: Option<PathBuf>,
    #[cfg_attr(not(windows), allow(dead_code))]
    app_version: String,
}

static STATE: OnceLock<State> = OnceLock::new();
static PREFERENCE: AtomicU8 = AtomicU8::new(0);
static CPU_ONLY: OnceLock<Result<bool, String>> = OnceLock::new();

/// Where the GPU failure record (and the Windows start-up marker) lives, and
/// the app version that keys them where drivers can't be fingerprinted. Call
/// once, before the first load; later calls are ignored.
pub fn configure(state_dir: Option<&Path>, app_version: &str) {
    let _ = STATE.set(State {
        health: GpuHealth::new(
            state_dir.map(|dir| dir.join("gpu-failures.json")),
            gpu_health::driver_now(app_version),
        ),
        state_dir: state_dir.map(Path::to_path_buf),
        app_version: app_version.to_string(),
    });
}

fn state() -> &'static State {
    STATE.get_or_init(|| State {
        health: GpuHealth::new(None, gpu_health::driver_now(env!("CARGO_PKG_VERSION"))),
        state_dir: None,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

pub(crate) fn health() -> &'static GpuHealth {
    &state().health
}

/// The device every later load uses.
pub fn set_device_preference(preference: DevicePreference) {
    PREFERENCE.store(preference as u8, Ordering::Relaxed);
}

pub fn device_preference() -> DevicePreference {
    match PREFERENCE.load(Ordering::Relaxed) {
        1 => DevicePreference::Gpu,
        2 => DevicePreference::Cpu,
        _ => DevicePreference::Auto,
    }
}

/// Forgets every GPU failure, so Auto tries each GPU again.
pub fn forget_gpu_failures() {
    health().forget_all();
}

/// Registers the backends once and returns whether only the CPU registered.
pub(crate) fn init() -> Result<bool, Error> {
    CPU_ONLY
        .get_or_init(|| init_once().map_err(|error| error.to_string()))
        .clone()
        .map_err(Error::Backend)
}

fn init_once() -> Result<bool, Error> {
    ensure_cpu_floor()?;
    transcribe_cpp::init_logging();
    if let Some(reason) = gpu_blocked() {
        tracing::warn!(reason, "transcribing on the CPU only");
        transcribe_cpp::init_backends_with(
            None::<&Path>,
            transcribe_cpp::BackendMask::for_backend(transcribe_cpp::Backend::Cpu),
        )?;
        return Ok(true);
    }
    guarded(|| {
        transcribe_cpp::init_backends_with(None::<&Path>, transcribe_cpp::BackendMask::ALL)?;
        // Enumerating the devices makes sure every backend started now.
        drop(transcribe_cpp::devices());
        Ok::<_, transcribe_cpp::Error>(())
    })?;
    Ok(false)
}

/// Why no GPU backend may start in this process, if one may not.
fn gpu_blocked() -> Option<&'static str> {
    #[cfg(windows)]
    {
        if !windows::vulkan_loader_present() {
            return Some("vulkan-1.dll is not installed; a GPU driver provides it");
        }
        if windows::crashed_before(state()) {
            return Some(
                "a previous launch of this version crashed while starting the GPU; \
                 the GPU is tried again after an update",
            );
        }
    }
    None
}

/// Runs `work`, which may start a GPU, under the Windows start-up marker: a
/// GPU driver crash can't be caught, so a marker left behind tells the next
/// launch to stay on the CPU.
pub(crate) fn guarded<T>(work: impl FnOnce() -> T) -> T {
    #[cfg(windows)]
    {
        windows::guarded(state(), work)
    }
    #[cfg(not(windows))]
    {
        work()
    }
}

/// ggml is built for x86-64 with AVX2, FMA and F16C (`GGML_NATIVE=OFF`); an
/// older CPU would crash on an illegal instruction instead of failing.
fn ensure_cpu_floor() -> Result<(), Error> {
    #[cfg(target_arch = "x86_64")]
    {
        let missing = [
            ("avx", std::arch::is_x86_feature_detected!("avx")),
            ("avx2", std::arch::is_x86_feature_detected!("avx2")),
            ("fma", std::arch::is_x86_feature_detected!("fma")),
            ("f16c", std::arch::is_x86_feature_detected!("f16c")),
        ]
        .into_iter()
        .filter_map(|(name, present)| (!present).then_some(name))
        .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Err(Error::UnsupportedCpu(missing.join(", ")));
        }
    }
    Ok(())
}

/// Every device transcription can run on, GPUs first.
pub fn devices() -> Result<Vec<SttDevice>, Error> {
    init()?;
    let mut devices = transcribe_cpp::devices()
        .into_iter()
        .filter(|device| {
            matches!(
                device.device_type,
                transcribe_cpp::DeviceType::Gpu
                    | transcribe_cpp::DeviceType::Igpu
                    | transcribe_cpp::DeviceType::Cpu
            )
        })
        .map(|device| {
            let id = gpu_health::device_key(&device);
            let gpu = device.device_type != transcribe_cpp::DeviceType::Cpu;
            SttDevice {
                failed: gpu && health().failed(&id),
                id,
                name: if device.description.is_empty() {
                    device.name.clone()
                } else {
                    device.description.clone()
                },
                kind: if gpu {
                    SttDeviceKind::Gpu
                } else {
                    SttDeviceKind::Cpu
                },
                backend: device.kind.clone(),
            }
        })
        .collect::<Vec<_>>();
    devices.sort_by_key(|device| device.kind == SttDeviceKind::Cpu);
    Ok(devices)
}

#[cfg(windows)]
mod windows {
    use super::State;

    pub(super) fn vulkan_loader_present() -> bool {
        unsafe extern "system" {
            fn LoadLibraryW(name: *const u16) -> *mut std::ffi::c_void;
            fn FreeLibrary(module: *mut std::ffi::c_void) -> i32;
        }
        let name = "vulkan-1.dll\0".encode_utf16().collect::<Vec<_>>();
        // SAFETY: `name` is NUL-terminated UTF-16; the handle is freed once.
        unsafe {
            let module = LoadLibraryW(name.as_ptr());
            if module.is_null() {
                return false;
            }
            FreeLibrary(module);
        }
        true
    }

    fn marker(state: &State) -> Option<std::path::PathBuf> {
        state
            .state_dir
            .as_ref()
            .map(|dir| dir.join("gpu-start.pending"))
    }

    pub(super) fn crashed_before(state: &State) -> bool {
        let Some(path) = marker(state) else {
            return false;
        };
        match std::fs::read_to_string(&path) {
            Ok(version) if version == state.app_version => true,
            Ok(_) => {
                let _ = std::fs::remove_file(&path);
                false
            }
            Err(_) => false,
        }
    }

    pub(super) fn guarded<T>(state: &State, work: impl FnOnce() -> T) -> T {
        let path = marker(state);
        if let Some(path) = &path {
            if let Some(dir) = path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            if let Err(error) = std::fs::write(path, &state.app_version) {
                tracing::warn!(%error, "could not write the GPU start marker");
            }
        }
        let out = work();
        if let Some(path) = &path {
            let _ = std::fs::remove_file(path);
        }
        out
    }
}
