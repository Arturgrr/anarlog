//! The transcribe.cpp speech models Librelog offers to download. Each one is a
//! single file pinned by its Hugging Face revision, byte size and SHA-256, and
//! is fetched on request from its publisher; Librelog never redistributes or
//! modifies it.
//!
//! The pins, language lists and language-hint rules come from Hex's catalog
//! (anomalyco/hex at 3dc7f538, `src/transcription/{artifacts,models}.rs`, MIT,
//! Copyright (c) 2026 Christopher Langton). The licences were read from each
//! file's repository at the pinned revision and from the model it converts.

mod catalog;

pub use catalog::WHISPER_LANGUAGES;

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, specta::Type,
)]
pub enum GgufModel {
    #[serde(rename = "gguf-whisper-large-v3-turbo")]
    WhisperLargeV3Turbo,
    #[serde(rename = "gguf-parakeet-tdt-0.6b-v3")]
    ParakeetTdtV3,
    #[serde(rename = "gguf-parakeet-ultra")]
    ParakeetUltra,
    #[serde(rename = "gguf-qwen3-asr-0.6b")]
    Qwen3Asr06B,
    #[serde(rename = "gguf-cohere-transcribe")]
    CohereTranscribe,
    #[serde(rename = "gguf-gigaam-v3")]
    GigaAmV3,
    #[serde(rename = "gguf-nb-whisper-medium")]
    NbWhisperMedium,
    #[serde(rename = "gguf-ivrit-whisper-large-v3-turbo")]
    IvritWhisperLargeV3Turbo,
    #[serde(rename = "gguf-nemotron-3.5-asr")]
    Nemotron35Asr,
}

/// One downloadable model file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GgufArtifact {
    pub repository: &'static str,
    pub revision: &'static str,
    pub filename: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
    /// What transcribe.cpp reports for the file (`Model::arch`, `Model::variant`).
    pub architecture: &'static str,
    pub variant: &'static str,
}

impl GgufArtifact {
    pub fn download_url(&self) -> String {
        format!(
            "https://huggingface.co/{}/resolve/{}/{}",
            self.repository, self.revision, self.filename
        )
    }

    /// The repository page at the pinned revision.
    pub fn source_url(&self) -> String {
        format!(
            "https://huggingface.co/{}/tree/{}",
            self.repository, self.revision
        )
    }
}

/// The licence a model is published under, as shown next to its download.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct License {
    /// The SPDX identifier, when the licence has one.
    pub spdx: Option<&'static str>,
    pub name: &'static str,
    /// The licence text.
    pub url: &'static str,
    /// The credit the licence asks for, naming the model, its author and the
    /// file's converter.
    pub attribution: &'static str,
}

/// The finest word timing a model gives.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, specta::Type,
)]
#[serde(rename_all = "lowercase")]
pub enum TimestampGranularity {
    /// Times for each word (token-level alignment).
    Word,
    /// Times for each segment; word times are spread across the segment.
    Segment,
    /// Text only; word times are spread across the speech chunk.
    None,
}

#[derive(Debug)]
pub struct GgufModelInfo {
    pub display_name: &'static str,
    pub description: &'static str,
    pub artifact: GgufArtifact,
    /// BCP-47 primary language codes; `["*"]` for Whisper's ~100 languages.
    pub languages: &'static [&'static str],
    pub detects_language: bool,
    pub accepts_language_hint: bool,
    /// The language a fine-tune always runs with: it lost language detection.
    pub forced_language: Option<&'static str>,
    pub timestamps: TimestampGranularity,
    pub license: License,
    pub recommended_memory_bytes: u64,
}

/// Settings › on-device transcription device (`local_stt_device`).
#[derive(
    Debug,
    Clone,
    Copy,
    Default,
    PartialEq,
    Eq,
    Hash,
    serde::Serialize,
    serde::Deserialize,
    specta::Type,
)]
#[serde(rename_all = "lowercase")]
#[repr(u8)]
pub enum DevicePreference {
    /// A GPU unless it failed before under its current driver, else the CPU.
    #[default]
    Auto = 0,
    /// The best GPU, even one that failed before.
    Gpu = 1,
    Cpu = 2,
}

/// One device on-device transcription can run on, for Settings.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct SttDevice {
    /// Stable within a machine and driver: description, backend and hardware id.
    pub id: String,
    pub name: String,
    pub kind: SttDeviceKind,
    /// "cpu", "metal", "vulkan", ...
    pub backend: String,
    /// It failed before under its current driver, so Auto skips it.
    pub failed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum SttDeviceKind {
    Gpu,
    Cpu,
}

#[derive(Debug)]
pub struct UnknownGgufModel(pub String);

impl std::fmt::Display for UnknownGgufModel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "unknown GGUF model: {}", self.0)
    }
}

impl std::error::Error for UnknownGgufModel {}

impl std::str::FromStr for GgufModel {
    type Err = UnknownGgufModel;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .iter()
            .copied()
            .find(|model| model.as_str() == value)
            .ok_or_else(|| UnknownGgufModel(value.to_string()))
    }
}

impl std::fmt::Display for GgufModel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl GgufModel {
    pub const ALL: &'static [GgufModel] = &[
        GgufModel::WhisperLargeV3Turbo,
        GgufModel::ParakeetTdtV3,
        GgufModel::ParakeetUltra,
        GgufModel::Qwen3Asr06B,
        GgufModel::CohereTranscribe,
        GgufModel::GigaAmV3,
        GgufModel::NbWhisperMedium,
        GgufModel::IvritWhisperLargeV3Turbo,
        GgufModel::Nemotron35Asr,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            GgufModel::WhisperLargeV3Turbo => "gguf-whisper-large-v3-turbo",
            GgufModel::ParakeetTdtV3 => "gguf-parakeet-tdt-0.6b-v3",
            GgufModel::ParakeetUltra => "gguf-parakeet-ultra",
            GgufModel::Qwen3Asr06B => "gguf-qwen3-asr-0.6b",
            GgufModel::CohereTranscribe => "gguf-cohere-transcribe",
            GgufModel::GigaAmV3 => "gguf-gigaam-v3",
            GgufModel::NbWhisperMedium => "gguf-nb-whisper-medium",
            GgufModel::IvritWhisperLargeV3Turbo => "gguf-ivrit-whisper-large-v3-turbo",
            GgufModel::Nemotron35Asr => "gguf-nemotron-3.5-asr",
        }
    }

    pub fn info(self) -> &'static GgufModelInfo {
        catalog::info(self)
    }

    pub fn artifact(self) -> &'static GgufArtifact {
        &self.info().artifact
    }

    /// The model file's place under the app's models directory.
    pub fn relative_path(self) -> std::path::PathBuf {
        std::path::Path::new("stt")
            .join("gguf")
            .join(self.artifact().filename)
    }

    /// Whether the model transcribes `language` (any BCP-47 tag; only its
    /// primary subtag counts).
    pub fn supports_language(self, language: &str) -> bool {
        let code = primary_subtag(language);
        let info = self.info();
        if info.languages == ["*"] {
            return WHISPER_LANGUAGES.contains(&code.as_str());
        }
        info.languages.contains(&code.as_str())
    }

    /// The language to pass transcribe.cpp for a request in `requested`
    /// (spoken languages, most likely first); `None` lets the model detect
    /// it or use its only language.
    pub fn runtime_language<S: AsRef<str>>(self, requested: &[S]) -> Option<String> {
        let info = self.info();
        if let Some(language) = info.forced_language {
            return Some(language.to_string());
        }
        if !info.accepts_language_hint {
            return None;
        }
        let chosen = requested
            .iter()
            .map(|language| primary_subtag(language.as_ref()))
            .find(|code| self.supports_language(code));
        let chosen = match chosen {
            Some(code) => code,
            None if info.detects_language => return None,
            None if self.supports_language("en") => "en".to_string(),
            None => info.languages.first()?.to_string(),
        };
        Some(self.runtime_code(&chosen))
    }

    fn runtime_code(self, code: &str) -> String {
        match self {
            GgufModel::WhisperLargeV3Turbo if code == "fil" => "tl".to_string(),
            // Its prompt takes locales such as `pt-BR`.
            GgufModel::Nemotron35Asr => catalog::NEMOTRON_3_5_LOCALES
                .iter()
                .find_map(|(language, locale)| (*language == code).then_some(*locale))
                .unwrap_or(code)
                .to_string(),
            _ => code.to_string(),
        }
    }

    /// The catalog model a file is, when its name matches a pinned file.
    pub fn from_filename(filename: &str) -> Option<GgufModel> {
        Self::ALL
            .iter()
            .copied()
            .find(|model| model.artifact().filename == filename)
    }
}

fn primary_subtag(language: &str) -> String {
    let code = language
        .split(['-', '_'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    // Norwegian Bokmål goes by Whisper's `no`; `iw` is Hebrew's old code.
    match code.as_str() {
        "nb" => "no".to_string(),
        "iw" => "he".to_string(),
        _ => code,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_entry_is_pinned_licensed_and_serializes_as_its_id() {
        let mut ids = std::collections::HashSet::new();
        let mut files = std::collections::HashSet::new();
        for model in GgufModel::ALL.iter().copied() {
            let info = model.info();
            let artifact = info.artifact;
            assert!(ids.insert(model.as_str()), "{model}");
            assert!(files.insert(artifact.filename), "{model}");
            assert_eq!(
                serde_json::to_string(&model).unwrap(),
                format!("\"{}\"", model.as_str())
            );
            assert_eq!(model.as_str().parse::<GgufModel>().unwrap(), model);
            assert_eq!(artifact.revision.len(), 40, "{model}");
            assert!(
                artifact.revision.chars().all(|c| c.is_ascii_hexdigit()),
                "{model}"
            );
            assert_eq!(artifact.sha256.len(), 64, "{model}");
            assert!(
                artifact
                    .sha256
                    .chars()
                    .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
                "{model}"
            );
            assert!(artifact.bytes > 0, "{model}");
            assert!(!info.license.name.is_empty(), "{model}");
            assert!(info.license.url.starts_with("https://"), "{model}");
            assert!(!info.license.attribution.is_empty(), "{model}");
            assert!(!info.languages.is_empty(), "{model}");
            assert!(
                artifact
                    .download_url()
                    .ends_with(&format!("/resolve/{}/{}", artifact.revision, artifact.filename))
            );
        }
    }

    #[test]
    fn language_hints_follow_each_models_input() {
        let cases: &[(GgufModel, &[&str], Option<&str>)] = &[
            (GgufModel::WhisperLargeV3Turbo, &["pt-BR"], Some("pt")),
            (GgufModel::WhisperLargeV3Turbo, &["fil"], Some("tl")),
            (GgufModel::WhisperLargeV3Turbo, &["xx"], None),
            (GgufModel::WhisperLargeV3Turbo, &[], None),
            (GgufModel::ParakeetTdtV3, &["pt"], None),
            (GgufModel::GigaAmV3, &["ru"], None),
            (GgufModel::Nemotron35Asr, &["pt"], Some("pt-BR")),
            (GgufModel::Nemotron35Asr, &["ko", "en"], Some("ko-KR")),
            (GgufModel::Nemotron35Asr, &["he"], None),
            (GgufModel::IvritWhisperLargeV3Turbo, &["en"], Some("he")),
            (GgufModel::NbWhisperMedium, &[], Some("no")),
            (GgufModel::WhisperLargeV3Turbo, &["nb-NO"], Some("no")),
            (GgufModel::CohereTranscribe, &["he", "pt"], Some("pt")),
            (GgufModel::CohereTranscribe, &["he"], Some("en")),
            (GgufModel::Qwen3Asr06B, &["he"], None),
        ];
        for (model, requested, expected) in cases {
            assert_eq!(
                model.runtime_language(requested).as_deref(),
                *expected,
                "{model} {requested:?}"
            );
        }
    }
}
