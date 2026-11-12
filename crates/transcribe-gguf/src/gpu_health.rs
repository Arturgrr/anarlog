//! GPUs that hung or failed while transcribing, remembered per device and
//! driver in `gpu-failures.json`, so Auto keeps that GPU off and transcribes
//! on another GPU or the CPU until the driver changes. A GPU context reset or
//! device loss comes back from ggml as an error, never as something to retry
//! safely on the same device: ggml keeps the lost Vulkan device for the
//! process, and asking a hung driver again can hang the desktop's GPU again.
//!
//! Adapted from anomalyco/hex at 3dc7f538 (`src/transcription/gpu_health.rs`).

use std::path::PathBuf;
use std::sync::Mutex;

/// At most this many remembered failures; the oldest go first.
const KEPT: usize = 16;

#[derive(Clone, Debug, serde::Deserialize, PartialEq, serde::Serialize)]
pub struct Failure {
    /// The device: its description, kind, and hardware id.
    pub device: String,
    /// Its driver when it failed (see [`driver_now`]).
    pub driver: String,
    /// The error, for the log.
    pub reason: String,
    /// Seconds since the Unix epoch.
    pub at: u64,
}

pub struct GpuHealth {
    path: Option<PathBuf>,
    driver: String,
    failures: Mutex<Option<Vec<Failure>>>,
}

impl GpuHealth {
    /// Failures stored at `path` (none in memory only), judged against the
    /// installed `driver`.
    pub fn new(path: Option<PathBuf>, driver: String) -> Self {
        Self {
            path,
            driver,
            failures: Mutex::new(None),
        }
    }

    fn with_failures<R>(&self, work: impl FnOnce(&mut Vec<Failure>) -> R) -> R {
        let mut failures = self
            .failures
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let failures = failures.get_or_insert_with(|| {
            self.path
                .as_ref()
                .and_then(|path| std::fs::read(path).ok())
                .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                .unwrap_or_default()
        });
        work(failures)
    }

    fn save(&self, failures: &[Failure]) {
        let Some(path) = &self.path else { return };
        let written = (|| -> std::io::Result<()> {
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir)?;
            }
            let staged = path.with_extension(format!("json.{}", std::process::id()));
            std::fs::write(&staged, serde_json::to_vec_pretty(failures)?)?;
            std::fs::rename(&staged, path)
        })();
        if let Err(error) = written {
            tracing::warn!(%error, path = %path.display(), "could not save the GPU failure record");
        }
    }

    /// Whether the device named `key` failed under the driver installed now.
    pub fn failed(&self, key: &str) -> bool {
        self.with_failures(|failures| {
            failures
                .iter()
                .any(|failure| failure.device == key && failure.driver == self.driver)
        })
    }

    /// Remembers that the device named `key` failed under the driver
    /// installed now.
    pub fn record(&self, key: &str, reason: &str) {
        let failure = Failure {
            device: key.to_string(),
            driver: self.driver.clone(),
            reason: reason.chars().take(400).collect(),
            at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |elapsed| elapsed.as_secs()),
        };
        tracing::warn!(
            device = failure.device,
            driver = failure.driver,
            reason = failure.reason,
            "the GPU failed while transcribing; Auto uses another device until its driver changes"
        );
        self.with_failures(|failures| {
            failures.retain(|old| old.device != failure.device || old.driver != failure.driver);
            failures.push(failure);
            let excess = failures.len().saturating_sub(KEPT);
            failures.drain(..excess);
            self.save(failures);
        });
    }

    /// Forgets the device's failure under the driver installed now, after it
    /// worked when chosen outright.
    pub fn forget(&self, key: &str) {
        self.with_failures(|failures| {
            let before = failures.len();
            failures.retain(|failure| failure.device != key || failure.driver != self.driver);
            if failures.len() != before {
                tracing::info!(device = key, "the GPU worked again; Auto uses it again");
                self.save(failures);
            }
        });
    }

    /// Forgets every remembered failure.
    pub fn forget_all(&self) {
        self.with_failures(|failures| {
            failures.clear();
            self.save(failures);
        });
    }

    #[cfg(test)]
    pub(crate) fn failures(&self) -> Vec<Failure> {
        self.with_failures(|failures| failures.clone())
    }
}

/// `device` as the failure record names it.
pub fn device_key(device: &transcribe_cpp::Device) -> String {
    format!(
        "{} ({}, {})",
        device.description,
        device.kind,
        device.device_id.as_deref().unwrap_or("-")
    )
}

/// Whether `error` says the device failed, rather than the request or the
/// model: the errors a hung or lost GPU, or one out of memory, returns.
pub fn device_error(error: &transcribe_cpp::Error) -> bool {
    matches!(
        error,
        transcribe_cpp::Error::Backend(_)
            | transcribe_cpp::Error::OutOfMemory(_)
            | transcribe_cpp::Error::ModelLoad(_)
            | transcribe_cpp::Error::Other(_)
    )
}

/// Whether `error` says the GPU ran out of memory. That is not a driver
/// fault: another copy of a model can fill a small GPU, so the GPU is not
/// remembered as failed for it.
pub fn out_of_memory(error: &transcribe_cpp::Error) -> bool {
    if matches!(error, transcribe_cpp::Error::OutOfMemory(_)) {
        return true;
    }
    let message = error.to_string().to_ascii_lowercase();
    message.contains("out of memory")
        || message.contains("outofdevicememory")
        || message.contains("out_of_device_memory")
        || message.contains("failed to allocate")
}

/// What a GPU's driver is now, so an update tries it again. Linux: the kernel
/// (i915, xe, amdgpu and nouveau live there) and every installed Vulkan
/// driver's library, by size and modification time. Elsewhere: this build of
/// the app (`app_version`).
pub fn driver_now(app_version: &str) -> String {
    #[cfg(target_os = "linux")]
    {
        let _ = app_version;
        linux_driver()
    }
    #[cfg(not(target_os = "linux"))]
    {
        app_version.to_string()
    }
}

#[cfg(target_os = "linux")]
fn linux_driver() -> String {
    use std::hash::{Hash, Hasher};
    use std::os::unix::fs::MetadataExt;
    let kernel = std::fs::read_to_string("/proc/sys/kernel/osrelease").unwrap_or_default();
    let mut directories = vec![PathBuf::from("/etc/vulkan/icd.d")];
    let data = std::env::var("XDG_DATA_DIRS")
        .ok()
        .filter(|dirs| !dirs.is_empty())
        .unwrap_or_else(|| "/usr/local/share:/usr/share".into());
    directories.extend(
        data.split(':')
            .filter(|dir| !dir.is_empty())
            .map(|dir| PathBuf::from(dir).join("vulkan/icd.d")),
    );
    let mut libraries = Vec::new();
    for directory in directories {
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let manifest = entry.path();
            let library = std::fs::read(&manifest)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
                .and_then(|json| json["ICD"]["library_path"].as_str().map(PathBuf::from));
            let Some(library) = library else { continue };
            let library = if library.is_absolute() {
                library
            } else if library.components().count() > 1 {
                directory.join(library)
            } else {
                // A bare name the loader finds on the library path.
                [
                    "/usr/lib",
                    "/usr/lib64",
                    "/usr/lib/x86_64-linux-gnu",
                    "/usr/lib/aarch64-linux-gnu",
                    "/run/opengl-driver/lib",
                ]
                .iter()
                .map(|dir| PathBuf::from(dir).join(&library))
                .find(|path| path.is_file())
                .unwrap_or(library)
            };
            let stamp = std::fs::metadata(&library)
                .map(|metadata| (metadata.len(), metadata.mtime()))
                .unwrap_or_default();
            libraries.push((library, stamp));
        }
    }
    libraries.sort();
    libraries.dedup();
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    libraries.hash(&mut hasher);
    format!("{} vulkan-{:016x}", kernel.trim(), hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failures_are_per_device_and_driver_capped_and_persisted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gpu-failures.json");
        let health = GpuHealth::new(Some(path.clone()), "driver-1".into());
        health.record("gpu-a", "device lost");
        assert!(health.failed("gpu-a"));
        assert!(!health.failed("gpu-b"));

        // Read back from disk, and a different driver tries the GPU again.
        assert!(GpuHealth::new(Some(path.clone()), "driver-1".into()).failed("gpu-a"));
        assert!(!GpuHealth::new(Some(path.clone()), "driver-2".into()).failed("gpu-a"));

        for index in 0..20 {
            health.record(&format!("gpu-{index}"), &"x".repeat(1_000));
        }
        let kept = health.failures();
        assert_eq!(kept.len(), KEPT);
        assert!(!health.failed("gpu-a"), "the oldest failure goes first");
        assert!(kept.iter().all(|failure| failure.reason.len() == 400));

        health.forget("gpu-19");
        assert!(!health.failed("gpu-19"));
        health.forget_all();
        assert!(
            GpuHealth::new(Some(path), "driver-1".into())
                .failures()
                .is_empty()
        );
    }

    #[test]
    fn out_of_memory_is_a_device_error_but_not_a_driver_fault() {
        let full = transcribe_cpp::Error::Backend(
            "vk::Device::allocateMemory: ErrorOutOfDeviceMemory".into(),
        );
        assert!(device_error(&full) && out_of_memory(&full));
        let lost = transcribe_cpp::Error::Backend("device lost".into());
        assert!(device_error(&lost) && !out_of_memory(&lost));
        assert!(!device_error(&transcribe_cpp::Error::InputTooShort(
            "x".into()
        )));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn the_linux_driver_names_the_kernel() {
        let kernel = std::fs::read_to_string("/proc/sys/kernel/osrelease").unwrap();
        assert!(driver_now("1.0.0").starts_with(kernel.trim()));
    }
}
