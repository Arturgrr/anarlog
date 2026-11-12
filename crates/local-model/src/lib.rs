use std::path::{Path, PathBuf};

use anlg_model_downloader::{DownloadableModel, Error};
pub use anlg_gguf_model::{GgufModel, TimestampGranularity};
pub use anlg_transcribe_soniqo::SoniqoModel;
pub use anlg_transcribe_speechanalyzer::AppleSpeechModel;
pub use anlg_whisper_local_model::WhisperModel;

pub const APPLE_SPEECH_DEFAULT_LOCALE: &str = "en-US";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, Eq, Hash, PartialEq)]
#[serde(untagged)]
pub enum LocalModel {
    Soniqo(SoniqoModel),
    AppleSpeech(AppleSpeechModel),
    Whisper(WhisperModel),
    Gguf(GgufModel),
}

/// Whether this build's platform runs transcribe.cpp models: macOS on Apple
/// silicon, Windows on x86_64, and Linux on x86_64 and aarch64.
pub const fn gguf_platform() -> bool {
    cfg!(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "linux", any(target_arch = "x86_64", target_arch = "aarch64")),
    ))
}

impl std::fmt::Display for LocalModel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LocalModel::Soniqo(model) => write!(f, "{model}"),
            LocalModel::AppleSpeech(model) => write!(f, "{model}"),
            LocalModel::Whisper(model) => write!(f, "whisper-{model}"),
            LocalModel::Gguf(model) => write!(f, "{model}"),
        }
    }
}

impl LocalModel {
    pub fn all() -> Vec<LocalModel> {
        let mut models = SoniqoModel::all()
            .iter()
            .copied()
            .map(LocalModel::Soniqo)
            .collect::<Vec<_>>();

        models.extend(
            AppleSpeechModel::all()
                .iter()
                .copied()
                .map(LocalModel::AppleSpeech),
        );

        models.extend([
            LocalModel::Whisper(WhisperModel::QuantizedTiny),
            LocalModel::Whisper(WhisperModel::QuantizedTinyEn),
            LocalModel::Whisper(WhisperModel::QuantizedBase),
            LocalModel::Whisper(WhisperModel::QuantizedBaseEn),
            LocalModel::Whisper(WhisperModel::QuantizedSmall),
            LocalModel::Whisper(WhisperModel::QuantizedSmallEn),
            LocalModel::Whisper(WhisperModel::QuantizedLargeTurbo),
        ]);

        models.extend(GgufModel::ALL.iter().copied().map(LocalModel::Gguf));

        models
    }

    pub fn kind(&self) -> &'static str {
        match self {
            LocalModel::Soniqo(_) => "stt-soniqo",
            LocalModel::AppleSpeech(_) => "stt-apple-speech",
            LocalModel::Whisper(_) => "stt-whisper",
            LocalModel::Gguf(_) => "stt-gguf",
        }
    }

    pub fn cli_name(&self) -> &'static str {
        match self {
            LocalModel::Soniqo(model) => model.as_str(),
            LocalModel::AppleSpeech(model) => model.as_str(),
            LocalModel::Whisper(WhisperModel::QuantizedTiny) => "whisper-tiny",
            LocalModel::Whisper(WhisperModel::QuantizedTinyEn) => "whisper-tiny-en",
            LocalModel::Whisper(WhisperModel::QuantizedBase) => "whisper-base",
            LocalModel::Whisper(WhisperModel::QuantizedBaseEn) => "whisper-base-en",
            LocalModel::Whisper(WhisperModel::QuantizedSmall) => "whisper-small",
            LocalModel::Whisper(WhisperModel::QuantizedSmallEn) => "whisper-small-en",
            LocalModel::Whisper(WhisperModel::QuantizedLargeTurbo) => "whisper-large-turbo",
            LocalModel::Gguf(model) => model.as_str(),
        }
    }

    pub fn install_path(&self, models_base: &Path) -> PathBuf {
        match self {
            LocalModel::Soniqo(model) => models_base.join("soniqo").join(model.as_str()),
            LocalModel::AppleSpeech(model) => models_base.join("apple-speech").join(model.as_str()),
            LocalModel::Whisper(model) => models_base.join("stt").join(model.file_name()),
            LocalModel::Gguf(model) => models_base.join(model.relative_path()),
        }
    }

    pub fn display_name(&self) -> String {
        match self {
            LocalModel::Soniqo(model) => model.display_name().to_string(),
            LocalModel::AppleSpeech(model) => model.display_name().to_string(),
            LocalModel::Whisper(model) => model.display_name().to_string(),
            LocalModel::Gguf(model) => model.info().display_name.to_string(),
        }
    }

    pub fn description(&self) -> String {
        match self {
            LocalModel::Soniqo(model) => model.description().to_string(),
            LocalModel::AppleSpeech(model) => model.description().to_string(),
            LocalModel::Whisper(model) => model.description(),
            LocalModel::Gguf(model) => model.info().description.to_string(),
        }
    }

    pub fn is_available_on_current_platform(&self) -> bool {
        let is_apple_silicon = cfg!(target_arch = "aarch64") && cfg!(target_os = "macos");

        match self {
            LocalModel::Soniqo(model) => model.is_available_on_current_platform(),
            LocalModel::AppleSpeech(model) => model.is_available_on_current_platform(),
            LocalModel::Whisper(_) => is_apple_silicon,
            LocalModel::Gguf(_) => gguf_platform(),
        }
    }
}

impl DownloadableModel for LocalModel {
    fn download_key(&self) -> String {
        match self {
            LocalModel::Soniqo(model) => format!("soniqo:{}", model.as_str()),
            LocalModel::AppleSpeech(model) => format!("apple-speech:{}", model.as_str()),
            LocalModel::Whisper(model) => format!("whisper:{}", model.file_name()),
            LocalModel::Gguf(model) => format!("gguf:{}", model.as_str()),
        }
    }

    fn download_url(&self) -> Option<String> {
        match self {
            LocalModel::Soniqo(_) | LocalModel::AppleSpeech(_) => None,
            LocalModel::Whisper(model) => Some(model.model_url().to_string()),
            LocalModel::Gguf(model) => Some(model.artifact().download_url()),
        }
    }

    fn download_checksum(&self) -> Option<u32> {
        match self {
            LocalModel::Soniqo(_) | LocalModel::AppleSpeech(_) | LocalModel::Gguf(_) => None,
            LocalModel::Whisper(model) => Some(model.checksum()),
        }
    }

    fn download_sha256(&self) -> Option<String> {
        match self {
            LocalModel::Gguf(model) => Some(model.artifact().sha256.to_string()),
            _ => None,
        }
    }

    fn download_size(&self) -> Option<u64> {
        match self {
            LocalModel::Gguf(model) => Some(model.artifact().bytes),
            _ => None,
        }
    }

    fn download_destination(&self, models_base: &Path) -> PathBuf {
        match self {
            LocalModel::Soniqo(model) => models_base.join("soniqo").join(model.as_str()),
            LocalModel::AppleSpeech(model) => models_base.join("apple-speech").join(model.as_str()),
            LocalModel::Whisper(model) => models_base.join("stt").join(model.file_name()),
            LocalModel::Gguf(model) => models_base.join(model.relative_path()),
        }
    }

    fn is_downloaded(&self, models_base: &Path) -> Result<bool, Error> {
        match self {
            LocalModel::Soniqo(model) => anlg_transcribe_soniqo::is_model_downloaded(*model)
                .map_err(|e| Error::OperationFailed(e.to_string())),
            LocalModel::AppleSpeech(_) => match anlg_transcribe_speechanalyzer::settings_locale() {
                Ok(locale) => anlg_transcribe_speechanalyzer::is_model_downloaded(&locale)
                    .map_err(|e| Error::OperationFailed(e.to_string())),
                Err(anlg_transcribe_speechanalyzer::Error::NoSupportedSystemLanguage)
                | Err(anlg_transcribe_speechanalyzer::Error::UnsupportedPlatform) => Ok(false),
                Err(error) => Err(Error::OperationFailed(error.to_string())),
            },
            LocalModel::Whisper(model) => {
                Ok(models_base.join("stt").join(model.file_name()).exists())
            }
            LocalModel::Gguf(model) => Ok(models_base.join(model.relative_path()).is_file()),
        }
    }

    fn finalize_download(&self, _downloaded_path: &Path, _models_base: &Path) -> Result<(), Error> {
        match self {
            LocalModel::Soniqo(_) => Err(Error::FinalizeFailed(
                "Soniqo models are downloaded through the Soniqo bridge".to_string(),
            )),
            LocalModel::AppleSpeech(_) => Err(Error::FinalizeFailed(
                "Apple Speech assets are installed by macOS".to_string(),
            )),
            LocalModel::Whisper(_) | LocalModel::Gguf(_) => Ok(()),
        }
    }

    fn delete_downloaded(&self, models_base: &Path) -> Result<(), Error> {
        match self {
            LocalModel::Soniqo(model) => anlg_transcribe_soniqo::delete_model(*model)
                .map_err(|e| Error::DeleteFailed(e.to_string())),
            // Only the reservation is ours to give back; macOS owns the asset files.
            LocalModel::AppleSpeech(_) => {
                let locale = anlg_transcribe_speechanalyzer::settings_locale()
                    .map_err(|e| Error::DeleteFailed(e.to_string()))?;
                anlg_transcribe_speechanalyzer::release_locale(&locale)
                    .map_err(|e| Error::DeleteFailed(e.to_string()))
            }
            LocalModel::Whisper(model) => {
                let model_path = models_base.join("stt").join(model.file_name());
                if model_path.exists() {
                    std::fs::remove_file(&model_path)
                        .map_err(|e| Error::DeleteFailed(e.to_string()))?;
                }
                Ok(())
            }
            LocalModel::Gguf(model) => {
                let model_path = models_base.join(model.relative_path());
                match std::fs::remove_file(&model_path) {
                    Ok(()) => Ok(()),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                    Err(error) => Err(Error::DeleteFailed(error.to_string())),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn soniqo_models_reject_generic_download_finalize() {
        let model = LocalModel::Soniqo(SoniqoModel::ParakeetStreaming);

        let error = model
            .finalize_download(Path::new("download"), Path::new("models"))
            .unwrap_err();

        assert!(error.to_string().contains("Soniqo bridge"));
    }

    /// `LocalModel` is untagged, so a GGUF id that another inner enum also
    /// accepted would deserialize as the wrong model.
    #[test]
    fn every_model_id_round_trips_to_itself() {
        let mut ids = std::collections::HashSet::new();
        for model in LocalModel::all() {
            let json = serde_json::to_string(&model).unwrap();
            assert!(ids.insert(json.clone()), "{json} is not unique");
            assert_eq!(serde_json::from_str::<LocalModel>(&json).unwrap(), model, "{json}");
        }
        for (json, expected) in [
            (
                r#""soniqo-parakeet-batch""#,
                LocalModel::Soniqo(SoniqoModel::ParakeetBatch),
            ),
            (r#""apple-speech""#, LocalModel::AppleSpeech(AppleSpeechModel::Default)),
            (r#""QuantizedSmall""#, LocalModel::Whisper(WhisperModel::QuantizedSmall)),
            (
                r#""gguf-parakeet-tdt-0.6b-v3""#,
                LocalModel::Gguf(GgufModel::ParakeetTdtV3),
            ),
        ] {
            assert_eq!(serde_json::from_str::<LocalModel>(json).unwrap(), expected);
        }
        assert!(serde_json::from_str::<LocalModel>(r#""gguf-unknown""#).is_err());
    }
}
