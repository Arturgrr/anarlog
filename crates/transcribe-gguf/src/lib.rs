//! In-process batch transcription with transcribe.cpp: GGUF files of every
//! family it runs (Whisper, Parakeet, Qwen3-ASR, Cohere, GigaAM, Nemotron)
//! and whisper.cpp `.bin` files, on Metal, Vulkan or the CPU.

mod backends;
mod credits;
pub mod gpu_health;
mod placement;
mod session;
mod timing;

use std::path::{Path, PathBuf};

pub use anlg_gguf_model::{DevicePreference, GgufModel, SttDevice, SttDeviceKind};
pub use backends::{
    configure, device_preference, devices, forget_gpu_failures, set_device_preference,
};
pub use transcribe_cpp::CancelToken;

use placement::{DeviceInfo, Loader, Placement};
use session::OfflineSession;

const SAMPLE_RATE: usize = 16_000;
/// Every run gets at least this much audio; shorter clips are padded with
/// silence (Parakeet rejects very short input).
const MIN_RUN_SAMPLES: usize = SAMPLE_RATE * 3 / 2;
/// Runs take at most this much audio, so timestamps stay reliable and no
/// model meets audio longer than it was trained on.
const MAX_RUN_SAMPLES: usize = SAMPLE_RATE * 30;
/// Cohere's encoder holds more, but its reference processor chunks at 35 s.
const COHERE_MAX_MS: i64 = 35_000;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Native(#[from] transcribe_cpp::Error),
    #[error("transcription backends: {0}")]
    Backend(String),
    #[error("{path} contains {found}, expected {expected}")]
    WrongModel {
        path: String,
        found: String,
        expected: String,
    },
    #[error("this CPU lacks {0}, which on-device transcription needs")]
    UnsupportedCpu(String),
    #[error("transcription was cancelled")]
    Cancelled,
}

/// Where word times came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum TimestampSource {
    /// Spread evenly across the audio: the model gives text only.
    None,
    /// Spread across the model's segments.
    Segment,
    /// The model's own word times.
    Word,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TimedWord {
    pub text: String,
    /// Seconds from the start of the audio.
    pub start: f64,
    pub end: f64,
    pub confidence: f64,
}

#[derive(Debug, Clone, Default)]
pub struct Request {
    /// Spoken languages, most likely first (BCP-47).
    pub languages: Vec<String>,
    /// A context prompt for Whisper and Qwen3-ASR; segments that only echo it
    /// are dropped.
    pub prompt: Option<String>,
    pub cancel: Option<CancelToken>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EngineTranscript {
    pub text: String,
    /// The language the model detected, when it reports one.
    pub language: Option<String>,
    pub words: Vec<TimedWord>,
    pub timestamps: TimestampSource,
}

#[derive(Debug, Clone)]
pub struct LoadOptions {
    /// The catalog entry the file is, for its language rules and to check the
    /// file is that model. `None` for a file the user picked.
    pub catalog: Option<GgufModel>,
    pub device: DevicePreference,
}

/// A loaded model, ready to transcribe 16 kHz mono audio. One run at a time.
pub struct Engine {
    path: PathBuf,
    catalog: Option<GgufModel>,
    session: OfflineSession,
    capabilities: transcribe_cpp::Capabilities,
    run_samples: usize,
    gpu: Option<DeviceInfo>,
    device_label: String,
}

impl std::fmt::Debug for Engine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Engine")
            .field("path", &self.path)
            .field("catalog", &self.catalog)
            .field("device", &self.device_label)
            .finish_non_exhaustive()
    }
}

struct NativeLoader<'a> {
    path: &'a Path,
    catalog: Option<GgufModel>,
    cpu_only: bool,
}

impl Loader for NativeLoader<'_> {
    type Loaded = Engine;

    fn cpu_only(&self) -> bool {
        self.cpu_only
    }

    fn gpus(&self) -> Vec<DeviceInfo> {
        let mut gpus = transcribe_cpp::devices()
            .into_iter()
            .filter(|device| {
                matches!(
                    device.device_type,
                    transcribe_cpp::DeviceType::Gpu | transcribe_cpp::DeviceType::Igpu
                )
            })
            .collect::<Vec<_>>();
        gpus.sort_by_key(|device| device.device_type != transcribe_cpp::DeviceType::Gpu);
        gpus.into_iter().map(device_info).collect()
    }

    fn load(&self, placement: &Placement) -> Result<Engine, Error> {
        let (backend, device) = match placement {
            Placement::Auto => (transcribe_cpp::Backend::Auto, None),
            Placement::Gpu(gpu) => (
                gpu.backend.unwrap_or(transcribe_cpp::Backend::Auto),
                gpu.device.clone(),
            ),
            Placement::Cpu => (transcribe_cpp::Backend::Cpu, None),
        };
        let load = || Engine::load_on(self.path, self.catalog, backend, device);
        if matches!(placement, Placement::Cpu) {
            load()
        } else {
            backends::guarded(load)
        }
    }

    fn gpu_of(&self, engine: &Engine) -> Option<DeviceInfo> {
        engine.gpu.clone()
    }
}

fn device_info(device: transcribe_cpp::Device) -> DeviceInfo {
    let backend = match device.kind.as_str() {
        "vulkan" => Some(transcribe_cpp::Backend::Vulkan),
        "cuda" => Some(transcribe_cpp::Backend::Cuda),
        "rocm" => Some(transcribe_cpp::Backend::Rocm),
        "metal" => Some(transcribe_cpp::Backend::Metal),
        _ => None,
    };
    DeviceInfo {
        key: gpu_health::device_key(&device),
        backend,
        device: Some(device),
    }
}

impl Engine {
    /// Loads `path` where `options.device` says, falling back to the CPU when
    /// the GPU fails (see `placement`).
    pub fn load(path: &Path, options: &LoadOptions) -> Result<Engine, Error> {
        let cpu_only = backends::init()?;
        let loader = NativeLoader {
            path,
            catalog: options.catalog,
            cpu_only,
        };
        placement::load_where(&loader, backends::health(), options.device)
    }

    fn load_on(
        path: &Path,
        catalog: Option<GgufModel>,
        backend: transcribe_cpp::Backend,
        device: Option<transcribe_cpp::Device>,
    ) -> Result<Engine, Error> {
        let model = transcribe_cpp::Model::load_with(
            path,
            &transcribe_cpp::ModelOptions {
                backend,
                device,
                ..Default::default()
            },
        )?;
        if let Some(catalog) = catalog {
            let artifact = catalog.artifact();
            let (architecture, variant) = (model.arch(), model.variant());
            if architecture != artifact.architecture || variant != artifact.variant {
                return Err(Error::WrongModel {
                    path: path.display().to_string(),
                    found: format!("{architecture}/{variant}"),
                    expected: format!("{}/{}", artifact.architecture, artifact.variant),
                });
            }
        }
        let capabilities = model.capabilities()?;
        let device = model.device()?;
        let gpu = matches!(
            device.device_type,
            transcribe_cpp::DeviceType::Gpu | transcribe_cpp::DeviceType::Igpu
        )
        .then(|| device_info(device.clone()));
        let device_label = format!("{} ({})", device.description, device.kind);
        let max_ms = match (model.arch().as_str(), capabilities.max_audio_ms) {
            ("cohere_asr", limit) if limit > 0 => limit.min(COHERE_MAX_MS),
            ("cohere_asr", _) => COHERE_MAX_MS,
            (_, limit) => limit,
        };
        let run_samples = usize::try_from(max_ms)
            .ok()
            .filter(|ms| *ms > 0)
            .map_or(MAX_RUN_SAMPLES, |ms| (ms * SAMPLE_RATE / 1_000).min(MAX_RUN_SAMPLES));
        tracing::info!(
            arch = model.arch(),
            variant = model.variant(),
            device = device_label,
            key = gpu.as_ref().map(|gpu| gpu.key.as_str()),
            "loaded local transcription model"
        );
        let mut engine = Engine {
            path: path.to_path_buf(),
            catalog,
            session: OfflineSession::new(model)?,
            capabilities,
            run_samples,
            gpu,
            device_label,
        };
        engine.warm()?;
        Ok(engine)
    }

    /// Runs 1.5 s of silence, so a GPU that cannot run the model fails at
    /// load, where the CPU can take over, and the first request is fast. A
    /// decoder that runs to its output limit on silence still ran the whole
    /// graph.
    fn warm(&mut self) -> Result<(), Error> {
        let options = self.run_options(None, None);
        match self.session.run(&vec![0.0; MIN_RUN_SAMPLES], &options, None) {
            Ok(_) | Err(transcribe_cpp::Error::OutputTruncated { .. }) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    /// Where the model runs, e.g. "Apple M2 (metal)".
    pub fn device_label(&self) -> &str {
        &self.device_label
    }

    pub fn on_gpu(&self) -> bool {
        self.gpu.is_some()
    }

    /// The finest word timing this model gives.
    pub fn timestamps(&self) -> TimestampSource {
        use transcribe_cpp::TimestampKind;
        match self.capabilities.max_timestamp_kind {
            TimestampKind::Word | TimestampKind::Token => TimestampSource::Word,
            TimestampKind::Segment | TimestampKind::Auto => TimestampSource::Segment,
            TimestampKind::None => TimestampSource::None,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn run_options(
        &self,
        language: Option<String>,
        prompt: Option<String>,
    ) -> transcribe_cpp::RunOptions {
        use transcribe_cpp::TimestampKind;
        transcribe_cpp::RunOptions {
            timestamps: match self.capabilities.max_timestamp_kind {
                TimestampKind::Word | TimestampKind::Token => TimestampKind::Word,
                kind => kind,
            },
            language,
            prompt,
            ..Default::default()
        }
    }

    fn language_for(&self, requested: &[String]) -> Option<String> {
        if let Some(catalog) = self.catalog {
            return catalog.runtime_language(requested);
        }
        // A file the user picked: the first requested language it lists.
        let offered = &self.capabilities.languages;
        requested.iter().find_map(|language| {
            let primary = language.split(['-', '_']).next().unwrap_or_default();
            offered
                .iter()
                .find(|code| {
                    code.eq_ignore_ascii_case(language)
                        || code.eq_ignore_ascii_case(primary)
                        || code
                            .to_ascii_lowercase()
                            .starts_with(&format!("{}-", primary.to_ascii_lowercase()))
                })
                .cloned()
        })
    }

    /// Transcribes 16 kHz mono `samples`, in runs the model takes whole.
    pub fn transcribe(
        &mut self,
        samples: &[f32],
        request: &Request,
    ) -> Result<EngineTranscript, Error> {
        match self.transcribe_here(samples, request) {
            Err(Error::Native(error)) if self.gpu.is_some() && gpu_health::device_error(&error) => {
                self.recover_on_cpu(Error::Native(error))?;
                self.transcribe_here(samples, request)
            }
            result => result,
        }
    }

    /// Reloads this model on the CPU after its GPU failed mid-run (a hang or
    /// reset comes back as an error), remembering the GPU once the CPU works.
    fn recover_on_cpu(&mut self, error: Error) -> Result<(), Error> {
        tracing::warn!(%error, "the GPU failed while transcribing; reloading the model on the CPU");
        let gpu = self.gpu.take();
        let cpu = Engine::load_on(&self.path, self.catalog, transcribe_cpp::Backend::Cpu, None)?;
        if let Some(gpu) = &gpu {
            placement::remember_failure(backends::health(), gpu, &error);
        }
        *self = cpu;
        Ok(())
    }

    fn transcribe_here(
        &mut self,
        samples: &[f32],
        request: &Request,
    ) -> Result<EngineTranscript, Error> {
        let language = self.language_for(&request.languages);
        let mut text = Vec::new();
        let mut words = Vec::new();
        let mut detected = None;
        let mut timestamps: Option<TimestampSource> = None;
        for (index, part) in samples.chunks(self.run_samples.max(1)).enumerate() {
            if request.cancel.as_ref().is_some_and(CancelToken::is_cancelled) {
                return Err(Error::Cancelled);
            }
            let mut padded = part.to_vec();
            if padded.len() < MIN_RUN_SAMPLES {
                padded.resize(MIN_RUN_SAMPLES, 0.0);
            }
            let transcript = self.run(&padded, language.clone(), request)?;
            let duration = part.len() as f64 / SAMPLE_RATE as f64;
            let (mut timed, source) = timing::words(&transcript, duration);
            timing::offset(
                &mut timed,
                (index * self.run_samples) as f64 / SAMPLE_RATE as f64,
            );
            if !timed.is_empty() {
                timestamps = Some(timestamps.map_or(source, |seen| seen.min(source)));
            }
            words.extend(timed);
            let part_text = transcript.text.trim();
            if !part_text.is_empty() {
                text.push(part_text.to_string());
            }
            detected = detected.or(transcript.language);
        }
        Ok(EngineTranscript {
            text: text.join(" "),
            language: detected,
            words,
            timestamps: timestamps.unwrap_or(TimestampSource::None),
        })
    }

    fn run(
        &mut self,
        samples: &[f32],
        language: Option<String>,
        request: &Request,
    ) -> Result<transcribe_cpp::Transcript, Error> {
        let options = self.run_options(language.clone(), request.prompt.clone());
        match self.session.run(samples, &options, request.cancel.as_ref()) {
            // A file the user picked may list a language it takes no hint for.
            Err(transcribe_cpp::Error::Unsupported(reason))
                if language.is_some() && self.catalog.is_none() =>
            {
                tracing::info!(reason, "the model took no language hint; letting it choose");
                let options = self.run_options(None, request.prompt.clone());
                Ok(self
                    .session
                    .run(samples, &options, request.cancel.as_ref())?)
            }
            Err(transcribe_cpp::Error::Aborted { .. }) => Err(Error::Cancelled),
            result => Ok(result?),
        }
    }

    /// The model's architecture and variant, e.g. `whisper`/`whisper-medium`.
    pub fn model_name(&self) -> (String, String) {
        let model = self.session.model();
        (model.arch(), model.variant())
    }
}
