//! Where a model loads: on Auto a GPU unless it failed before under its
//! current driver (then another healthy GPU, else the CPU), on GPU the best
//! GPU, on CPU the CPU. A GPU load that fails retries on the CPU, and when the
//! CPU works the GPU is remembered as failed, unless it only ran out of
//! memory. A GPU chosen outright that works is forgiven.
//!
//! Adapted from anomalyco/hex at 3dc7f538
//! (`src/transcription/local_transcriber.rs`, `LocalTranscriber::load_where`).

use crate::gpu_health::{GpuHealth, out_of_memory};
use crate::{DevicePreference, Error};

#[derive(Clone, Debug)]
pub(crate) struct DeviceInfo {
    /// [`crate::gpu_health::device_key`].
    pub(crate) key: String,
    /// The backend that runs on this device alone.
    pub(crate) backend: Option<transcribe_cpp::Backend>,
    /// The native device; tests have none.
    pub(crate) device: Option<transcribe_cpp::Device>,
}

#[derive(Debug)]
pub(crate) enum Placement {
    /// The library's own choice: the best GPU, else the CPU.
    Auto,
    Gpu(DeviceInfo),
    Cpu,
}

pub(crate) trait Loader {
    type Loaded;
    /// The process registered only the CPU backend.
    fn cpu_only(&self) -> bool;
    /// The GPUs, best first.
    fn gpus(&self) -> Vec<DeviceInfo>;
    /// Loads (and warms) the model.
    fn load(&self, placement: &Placement) -> Result<Self::Loaded, Error>;
    /// The GPU the model runs on; `None` on the CPU.
    fn gpu_of(&self, loaded: &Self::Loaded) -> Option<DeviceInfo>;
}

pub(crate) fn load_where<L: Loader>(
    loader: &L,
    health: &GpuHealth,
    preference: DevicePreference,
) -> Result<L::Loaded, Error> {
    if loader.cpu_only() || preference == DevicePreference::Cpu {
        return loader.load(&Placement::Cpu);
    }
    let gpus = loader.gpus();
    let placement =
        if preference == DevicePreference::Gpu || !gpus.iter().any(|gpu| health.failed(&gpu.key)) {
            Placement::Auto
        } else {
            match gpus
                .iter()
                .find(|gpu| !health.failed(&gpu.key) && gpu.backend.is_some())
            {
                Some(gpu) => Placement::Gpu(gpu.clone()),
                None => {
                    tracing::info!(
                        "every GPU failed before under its current driver; transcribing on the CPU"
                    );
                    return loader.load(&Placement::Cpu);
                }
            }
        };
    // The GPU this load runs on: the one chosen, else the one Auto picks.
    let expected = match &placement {
        Placement::Gpu(gpu) => Some(gpu.clone()),
        _ => gpus.into_iter().next(),
    };
    match loader.load(&placement) {
        Ok(loaded) => {
            if preference == DevicePreference::Gpu
                && let Some(gpu) = loader.gpu_of(&loaded)
            {
                health.forget(&gpu.key);
            }
            Ok(loaded)
        }
        Err(error) => {
            tracing::warn!(%error, "could not load the transcription model on the GPU; loading it on the CPU");
            let loaded = loader.load(&Placement::Cpu)?;
            if let Some(gpu) = &expected {
                remember_failure(health, gpu, &error);
            }
            Ok(loaded)
        }
    }
}

/// Records `gpu` as failed for `error`, unless it only ran out of memory.
pub(crate) fn remember_failure(health: &GpuHealth, gpu: &DeviceInfo, error: &Error) {
    match error {
        Error::Native(native) if out_of_memory(native) => {
            tracing::info!("the GPU ran out of memory; not remembering it as failed");
        }
        error => health.record(&gpu.key, &error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;

    struct FakeLoader {
        gpus: Vec<&'static str>,
        /// GPUs that fail to load, and whether they ran out of memory.
        broken: Vec<(&'static str, bool)>,
        cpu_only: bool,
        /// Where each load was asked to run.
        asked: RefCell<Vec<String>>,
    }

    impl FakeLoader {
        fn new(gpus: &[&'static str]) -> Self {
            Self {
                gpus: gpus.to_vec(),
                broken: Vec::new(),
                cpu_only: false,
                asked: RefCell::new(Vec::new()),
            }
        }
    }

    fn info(key: &str) -> DeviceInfo {
        DeviceInfo {
            key: key.to_string(),
            backend: Some(transcribe_cpp::Backend::Vulkan),
            device: None,
        }
    }

    impl Loader for FakeLoader {
        type Loaded = String;

        fn cpu_only(&self) -> bool {
            self.cpu_only
        }

        fn gpus(&self) -> Vec<DeviceInfo> {
            self.gpus.iter().map(|key| info(key)).collect()
        }

        fn load(&self, placement: &Placement) -> Result<String, Error> {
            let target = match placement {
                Placement::Auto => self.gpus.first().copied().unwrap_or("cpu").to_string(),
                Placement::Gpu(gpu) => gpu.key.clone(),
                Placement::Cpu => "cpu".to_string(),
            };
            self.asked.borrow_mut().push(target.clone());
            match self.broken.iter().find(|(key, _)| *key == target) {
                Some((_, true)) => Err(Error::Native(transcribe_cpp::Error::OutOfMemory(
                    "ErrorOutOfDeviceMemory".into(),
                ))),
                Some((_, false)) => Err(Error::Native(transcribe_cpp::Error::Backend(
                    "device lost".into(),
                ))),
                None => Ok(target),
            }
        }

        fn gpu_of(&self, loaded: &String) -> Option<DeviceInfo> {
            (loaded != "cpu").then(|| info(loaded))
        }
    }

    fn health() -> GpuHealth {
        GpuHealth::new(None, "driver".into())
    }

    #[test]
    fn a_failed_gpu_falls_back_to_the_cpu_and_is_remembered() {
        let health = health();
        let mut loader = FakeLoader::new(&["dgpu"]);
        loader.broken.push(("dgpu", false));

        let loaded = load_where(&loader, &health, DevicePreference::Auto).unwrap();
        assert_eq!(loaded, "cpu");
        assert!(health.failed("dgpu"));

        // Next time Auto goes straight to the CPU.
        loader.asked.borrow_mut().clear();
        let loaded = load_where(&loader, &health, DevicePreference::Auto).unwrap();
        assert_eq!(loaded, "cpu");
        assert_eq!(*loader.asked.borrow(), ["cpu"]);
    }

    #[test]
    fn auto_uses_another_healthy_gpu_before_the_cpu() {
        let health = health();
        health.record("dgpu", "hung");
        let loader = FakeLoader::new(&["dgpu", "igpu"]);

        assert_eq!(
            load_where(&loader, &health, DevicePreference::Auto).unwrap(),
            "igpu"
        );

        health.record("igpu", "hung");
        assert_eq!(
            load_where(&loader, &health, DevicePreference::Auto).unwrap(),
            "cpu"
        );
    }

    #[test]
    fn out_of_memory_is_not_remembered() {
        let health = health();
        let mut loader = FakeLoader::new(&["dgpu"]);
        loader.broken.push(("dgpu", true));

        assert_eq!(
            load_where(&loader, &health, DevicePreference::Auto).unwrap(),
            "cpu"
        );
        assert!(!health.failed("dgpu"));
    }

    #[test]
    fn choosing_the_gpu_retries_it_and_forgets_its_failure_once_it_works() {
        let health = health();
        health.record("dgpu", "hung");
        let loader = FakeLoader::new(&["dgpu"]);

        assert_eq!(
            load_where(&loader, &health, DevicePreference::Gpu).unwrap(),
            "dgpu"
        );
        assert!(!health.failed("dgpu"));
    }

    #[test]
    fn cpu_preference_and_cpu_only_processes_never_touch_a_gpu() {
        let health = health();
        let mut loader = FakeLoader::new(&["dgpu"]);
        assert_eq!(
            load_where(&loader, &health, DevicePreference::Cpu).unwrap(),
            "cpu"
        );
        loader.cpu_only = true;
        assert_eq!(
            load_where(&loader, &health, DevicePreference::Gpu).unwrap(),
            "cpu"
        );
        assert_eq!(*loader.asked.borrow(), ["cpu", "cpu"]);
    }
}
