pub use anlg_local_model::{
    AppleSpeechModel, GgufModel, LocalModel, SoniqoModel, TimestampGranularity, WhisperModel,
    gguf_platform,
};

pub static SUPPORTED_MODELS: &[LocalModel] = &[
    LocalModel::Soniqo(SoniqoModel::ParakeetStreaming),
    LocalModel::Soniqo(SoniqoModel::ParakeetBatch),
    LocalModel::AppleSpeech(AppleSpeechModel::Default),
    LocalModel::Gguf(GgufModel::WhisperLargeV3Turbo),
    LocalModel::Gguf(GgufModel::ParakeetTdtV3),
    LocalModel::Gguf(GgufModel::ParakeetUltra),
    LocalModel::Gguf(GgufModel::Qwen3Asr06B),
    LocalModel::Gguf(GgufModel::CohereTranscribe),
    LocalModel::Gguf(GgufModel::GigaAmV3),
    LocalModel::Gguf(GgufModel::NbWhisperMedium),
    LocalModel::Gguf(GgufModel::IvritWhisperLargeV3Turbo),
    LocalModel::Gguf(GgufModel::Nemotron35Asr),
];

#[derive(serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum SttModelType {
    Soniqo,
    AppleSpeech,
    Whispercpp,
    Gguf,
}

/// The licence a downloadable model is published under.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SttModelLicense {
    pub spdx: Option<String>,
    pub name: String,
    pub url: String,
    pub attribution: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SttModelInfo {
    pub key: LocalModel,
    pub display_name: String,
    pub description: String,
    pub size_bytes: Option<u64>,
    pub model_type: SttModelType,
    pub supports_realtime: bool,
    pub recommended_memory_bytes: u64,
    /// BCP-47 primary language codes; `["*"]` for multilingual with detection.
    /// Empty when the runtime decides (Soniqo, Apple Speech).
    pub languages: Vec<String>,
    /// Set for downloadable GGUF models.
    pub license: Option<SttModelLicense>,
    /// The repository the model file comes from, at its pinned revision.
    pub source_url: Option<String>,
    /// Set for GGUF models.
    pub timestamps: Option<TimestampGranularity>,
}

const GIB: u64 = 1024 * 1024 * 1024;

fn recommended_memory_bytes(model: &LocalModel) -> u64 {
    match model {
        LocalModel::Soniqo(SoniqoModel::ParakeetStreaming) => 8 * GIB,
        LocalModel::Soniqo(SoniqoModel::ParakeetBatch | SoniqoModel::Omnilingual) => 16 * GIB,
        LocalModel::Soniqo(SoniqoModel::Qwen3Small) => 16 * GIB,
        LocalModel::Soniqo(SoniqoModel::Qwen3Large) => 32 * GIB,
        LocalModel::AppleSpeech(_) => 8 * GIB,
        LocalModel::Whisper(_) => 8 * GIB,
        LocalModel::Gguf(model) => model.info().recommended_memory_bytes,
    }
}

pub fn stt_model_info(model: &LocalModel) -> SttModelInfo {
    let recommended_memory_bytes = recommended_memory_bytes(model);
    match model {
        LocalModel::Soniqo(value) => SttModelInfo {
            key: model.clone(),
            display_name: value.display_name().to_string(),
            description: value.description().to_string(),
            size_bytes: Some(value.size_bytes()),
            model_type: SttModelType::Soniqo,
            supports_realtime: value.supports_live(),
            recommended_memory_bytes,
            languages: Vec::new(),
            license: None,
            source_url: None,
            timestamps: None,
        },
        LocalModel::AppleSpeech(value) => SttModelInfo {
            key: model.clone(),
            display_name: value.display_name().to_string(),
            description: value.description().to_string(),
            // macOS installs and shares the assets, so there is nothing for us to download.
            size_bytes: None,
            model_type: SttModelType::AppleSpeech,
            supports_realtime: value.supports_live(),
            recommended_memory_bytes,
            languages: Vec::new(),
            license: None,
            source_url: None,
            timestamps: None,
        },
        LocalModel::Whisper(value) => SttModelInfo {
            key: model.clone(),
            display_name: value.display_name().to_string(),
            description: value.description(),
            size_bytes: Some(value.model_size_bytes()),
            model_type: SttModelType::Whispercpp,
            supports_realtime: false,
            recommended_memory_bytes,
            languages: Vec::new(),
            license: None,
            source_url: None,
            timestamps: None,
        },
        LocalModel::Gguf(value) => {
            let info = value.info();
            SttModelInfo {
                key: model.clone(),
                display_name: info.display_name.to_string(),
                description: info.description.to_string(),
                size_bytes: Some(info.artifact.bytes),
                model_type: SttModelType::Gguf,
                supports_realtime: false,
                recommended_memory_bytes,
                languages: info.languages.iter().map(|code| code.to_string()).collect(),
                license: Some(SttModelLicense {
                    spdx: info.license.spdx.map(str::to_string),
                    name: info.license.name.to_string(),
                    url: info.license.url.to_string(),
                    attribution: Some(info.license.attribution.to_string()),
                }),
                source_url: Some(info.artifact.source_url()),
                timestamps: Some(info.timestamps),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_models_include_soniqo_models_from_rust_source_of_truth() {
        let supported_soniqo_models = SUPPORTED_MODELS
            .iter()
            .filter_map(|model| match model {
                LocalModel::Soniqo(value) => Some(*value),
                _ => None,
            })
            .collect::<Vec<_>>();

        assert_eq!(supported_soniqo_models, SoniqoModel::selectable());

        let supported_gguf_models = SUPPORTED_MODELS
            .iter()
            .filter_map(|model| match model {
                LocalModel::Gguf(value) => Some(*value),
                _ => None,
            })
            .collect::<Vec<_>>();

        assert_eq!(supported_gguf_models, GgufModel::ALL);
    }

    #[test]
    fn every_supported_model_has_unique_hardware_and_runtime_metadata() {
        let mut keys = std::collections::HashSet::new();

        for model in SUPPORTED_MODELS {
            let info = stt_model_info(model);
            let supports_realtime = match model {
                LocalModel::Soniqo(model) => model.supports_live(),
                LocalModel::AppleSpeech(model) => model.supports_live(),
                LocalModel::Whisper(_) | LocalModel::Gguf(_) => false,
            };

            assert!(keys.insert(info.key.cli_name()));
            assert!(!info.display_name.trim().is_empty());
            assert!(!info.description.trim().is_empty());
            assert_eq!(info.supports_realtime, supports_realtime);
            assert!(info.recommended_memory_bytes > 0);
            if matches!(model, LocalModel::Gguf(_)) {
                assert!(!info.languages.is_empty());
                assert!(info.license.is_some());
                assert!(info.timestamps.is_some());
            }
        }
    }

    #[test]
    fn gguf_model_info_serializes_with_the_frontend_contract() {
        let value =
            serde_json::to_value(stt_model_info(&LocalModel::Gguf(GgufModel::ParakeetTdtV3)))
                .unwrap();

        assert_eq!(value["key"], "gguf-parakeet-tdt-0.6b-v3");
        assert_eq!(value["model_type"], "gguf");
        assert_eq!(value["timestamps"], "word");
        assert_eq!(value["size_bytes"], 739_508_576);
        assert_eq!(value["license"]["spdx"], "CC-BY-4.0");
        assert!(
            value["languages"]
                .as_array()
                .unwrap()
                .contains(&"pt".into())
        );
    }
}
