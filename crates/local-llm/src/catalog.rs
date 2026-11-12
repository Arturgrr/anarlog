use std::path::{Path, PathBuf};

/// The chat models Librelog offers to download and run with its built-in
/// llama.cpp server. Each is one Q4_K_M GGUF file from its publisher's own
/// Hugging Face repository, pinned by revision, byte size and SHA-256, and
/// used unmodified.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, specta::Type,
)]
pub enum LlmModel {
    #[serde(rename = "qwen3-4b")]
    Qwen3_4B,
    #[serde(rename = "qwen3-8b")]
    Qwen3_8B,
    #[serde(rename = "granite-4.0-micro")]
    Granite4Micro,
    #[serde(rename = "ministral-3-8b")]
    Ministral3_8B,
    #[serde(rename = "ministral-3-3b")]
    Ministral3_3B,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LlmArtifact {
    pub repository: &'static str,
    pub revision: &'static str,
    pub filename: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
}

impl LlmArtifact {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct License {
    pub spdx: &'static str,
    pub name: &'static str,
    pub url: &'static str,
    pub attribution: &'static str,
}

#[derive(Debug)]
pub struct LlmModelInfo {
    pub display_name: &'static str,
    pub artifact: LlmArtifact,
    pub license: License,
    /// The context length the GGUF declares (`<arch>.context_length`).
    pub context_length: u32,
    /// Bytes of f16 KV cache per token: layers x 2 (K and V) x KV heads x
    /// head dimension x 2 bytes, from the GGUF's metadata.
    pub kv_bytes_per_token: u64,
}

const APACHE_URL: &str = "https://www.apache.org/licenses/LICENSE-2.0";

// Values read from each file at its pinned revision: size and SHA-256 from
// Hugging Face (`x-linked-size`, `x-linked-etag`), context and KV shape from
// the GGUF header (`block_count`, `attention.head_count_kv`,
// `attention.key_length`/`value_length` or embedding / head count), and the
// licence from the repository's README front matter.
static QWEN3_4B: LlmModelInfo = LlmModelInfo {
    display_name: "Qwen3 4B",
    artifact: LlmArtifact {
        repository: "Qwen/Qwen3-4B-GGUF",
        revision: "bc640142c66e1fdd12af0bd68f40445458f3869b",
        filename: "Qwen3-4B-Q4_K_M.gguf",
        bytes: 2_497_280_256,
        sha256: "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5",
    },
    license: License {
        spdx: "Apache-2.0",
        name: "Apache License 2.0",
        url: "https://huggingface.co/Qwen/Qwen3-4B-GGUF/blob/bc640142c66e1fdd12af0bd68f40445458f3869b/LICENSE",
        attribution: "Qwen3 4B by the Qwen team, Alibaba Cloud, licensed under the Apache \
                      License 2.0. GGUF file published by Qwen.",
    },
    context_length: 40_960,
    // 36 layers x 2 x 8 KV heads x 128.
    kv_bytes_per_token: 36 * 2 * 8 * 128 * 2,
};

static QWEN3_8B: LlmModelInfo = LlmModelInfo {
    display_name: "Qwen3 8B",
    artifact: LlmArtifact {
        repository: "Qwen/Qwen3-8B-GGUF",
        revision: "7c41481f57cb95916b40956ab2f0b139b296d974",
        filename: "Qwen3-8B-Q4_K_M.gguf",
        bytes: 5_027_783_488,
        sha256: "d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785",
    },
    license: License {
        spdx: "Apache-2.0",
        name: "Apache License 2.0",
        url: "https://huggingface.co/Qwen/Qwen3-8B-GGUF/blob/7c41481f57cb95916b40956ab2f0b139b296d974/LICENSE",
        attribution: "Qwen3 8B by the Qwen team, Alibaba Cloud, licensed under the Apache \
                      License 2.0. GGUF file published by Qwen.",
    },
    context_length: 40_960,
    // 36 layers x 2 x 8 KV heads x 128.
    kv_bytes_per_token: 36 * 2 * 8 * 128 * 2,
};

static GRANITE_4_MICRO: LlmModelInfo = LlmModelInfo {
    display_name: "Granite 4.0 Micro",
    artifact: LlmArtifact {
        repository: "ibm-granite/granite-4.0-micro-GGUF",
        revision: "ec48475f0c811d812fbfb61975717a9c36eeb652",
        filename: "granite-4.0-micro-Q4_K_M.gguf",
        bytes: 2_099_502_528,
        sha256: "97c417dcc0534b0737c74016fb2af083cb17c3b51eaac621192d23961b7024eb",
    },
    license: License {
        spdx: "Apache-2.0",
        name: "Apache License 2.0",
        url: APACHE_URL,
        attribution: "Granite 4.0 Micro by IBM, licensed under the Apache License 2.0. GGUF \
                      file published by IBM Granite.",
    },
    context_length: 131_072,
    // 40 attention layers x 2 x 8 KV heads x 64 (2560 / 40 heads).
    kv_bytes_per_token: 40 * 2 * 8 * 64 * 2,
};

static MINISTRAL_3_8B: LlmModelInfo = LlmModelInfo {
    display_name: "Ministral 3 8B",
    artifact: LlmArtifact {
        repository: "mistralai/Ministral-3-8B-Instruct-2512-GGUF",
        revision: "0102285ad796bd99af90f58de616092e5630e970",
        filename: "Ministral-3-8B-Instruct-2512-Q4_K_M.gguf",
        bytes: 5_198_911_904,
        sha256: "33e7a72cf5e6e2cfc2f2847075acc013d68bba023e35310cef86b5cf8fdca761",
    },
    license: License {
        spdx: "Apache-2.0",
        name: "Apache License 2.0",
        url: APACHE_URL,
        attribution: "Ministral 3 8B Instruct (2512) by Mistral AI, licensed under the Apache \
                      License 2.0. GGUF file published by Mistral AI.",
    },
    context_length: 262_144,
    // 34 layers x 2 x 8 KV heads x 128.
    kv_bytes_per_token: 34 * 2 * 8 * 128 * 2,
};

static MINISTRAL_3_3B: LlmModelInfo = LlmModelInfo {
    display_name: "Ministral 3 3B",
    artifact: LlmArtifact {
        repository: "mistralai/Ministral-3-3B-Instruct-2512-GGUF",
        revision: "eb599d408350ea2bb60452cb86be7c7b2fc28227",
        filename: "Ministral-3-3B-Instruct-2512-Q4_K_M.gguf",
        bytes: 2_147_023_008,
        sha256: "9ed150d4367e68df0ac8e1540f6ddc65b42d0ee26378329d1ecbca60f93fc5f8",
    },
    license: License {
        spdx: "Apache-2.0",
        name: "Apache License 2.0",
        url: APACHE_URL,
        attribution: "Ministral 3 3B Instruct (2512) by Mistral AI, licensed under the Apache \
                      License 2.0. GGUF file published by Mistral AI.",
    },
    context_length: 262_144,
    // 26 layers x 2 x 8 KV heads x 128.
    kv_bytes_per_token: 26 * 2 * 8 * 128 * 2,
};

#[derive(Debug)]
pub struct UnknownLlmModel(pub String);

impl std::fmt::Display for UnknownLlmModel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "unknown built-in model: {}", self.0)
    }
}

impl std::error::Error for UnknownLlmModel {}

impl std::str::FromStr for LlmModel {
    type Err = UnknownLlmModel;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .iter()
            .copied()
            .find(|model| model.as_str() == value)
            .ok_or_else(|| UnknownLlmModel(value.to_string()))
    }
}

impl std::fmt::Display for LlmModel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl LlmModel {
    pub const ALL: &'static [LlmModel] = &[
        LlmModel::Qwen3_4B,
        LlmModel::Qwen3_8B,
        LlmModel::Granite4Micro,
        LlmModel::Ministral3_8B,
        LlmModel::Ministral3_3B,
    ];

    /// What onboarding offers and what Settings suggests first.
    pub const DEFAULT: LlmModel = LlmModel::Qwen3_4B;

    pub const fn as_str(self) -> &'static str {
        match self {
            LlmModel::Qwen3_4B => "qwen3-4b",
            LlmModel::Qwen3_8B => "qwen3-8b",
            LlmModel::Granite4Micro => "granite-4.0-micro",
            LlmModel::Ministral3_8B => "ministral-3-8b",
            LlmModel::Ministral3_3B => "ministral-3-3b",
        }
    }

    pub fn info(self) -> &'static LlmModelInfo {
        match self {
            LlmModel::Qwen3_4B => &QWEN3_4B,
            LlmModel::Qwen3_8B => &QWEN3_8B,
            LlmModel::Granite4Micro => &GRANITE_4_MICRO,
            LlmModel::Ministral3_8B => &MINISTRAL_3_8B,
            LlmModel::Ministral3_3B => &MINISTRAL_3_3B,
        }
    }

    pub fn artifact(self) -> &'static LlmArtifact {
        &self.info().artifact
    }

    /// The model file's place under the app's models directory.
    pub fn relative_path(self) -> PathBuf {
        Path::new("llm").join(self.artifact().filename)
    }
}

impl anlg_model_downloader::DownloadableModel for LlmModel {
    fn download_key(&self) -> String {
        format!("llm:{}", self.as_str())
    }

    fn download_url(&self) -> Option<String> {
        Some(self.artifact().download_url())
    }

    fn download_sha256(&self) -> Option<String> {
        Some(self.artifact().sha256.to_string())
    }

    fn download_size(&self) -> Option<u64> {
        Some(self.artifact().bytes)
    }

    fn download_destination(&self, models_base: &Path) -> PathBuf {
        models_base.join(self.relative_path())
    }

    fn is_downloaded(&self, models_base: &Path) -> Result<bool, anlg_model_downloader::Error> {
        // A file of the pinned size; the downloader checked its SHA-256
        // before moving it into place.
        Ok(std::fs::metadata(self.download_destination(models_base))
            .is_ok_and(|meta| meta.is_file() && meta.len() == self.artifact().bytes))
    }

    fn finalize_download(
        &self,
        _downloaded_path: &Path,
        _models_base: &Path,
    ) -> Result<(), anlg_model_downloader::Error> {
        Ok(())
    }

    fn delete_downloaded(&self, models_base: &Path) -> Result<(), anlg_model_downloader::Error> {
        std::fs::remove_file(self.download_destination(models_base))
            .map_err(|error| anlg_model_downloader::Error::DeleteFailed(error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The model publishers' own Hugging Face accounts. Files from converters
    // (unsloth, bartowski, ...) were not approved.
    const PUBLISHERS: &[&str] = &["Qwen", "ibm-granite", "mistralai"];

    // A catalog edit that breaks a pin would download an unverified or
    // third-party file.
    #[test]
    fn every_entry_is_pinned_to_its_publishers_repository() {
        let mut ids = std::collections::HashSet::new();
        let mut files = std::collections::HashSet::new();
        for model in LlmModel::ALL.iter().copied() {
            let info = model.info();
            let artifact = info.artifact;
            assert!(ids.insert(model.as_str()), "{model}");
            assert!(files.insert(artifact.filename), "{model}");
            assert_eq!(
                serde_json::to_string(&model).unwrap(),
                format!("\"{}\"", model.as_str())
            );
            assert_eq!(model.as_str().parse::<LlmModel>().unwrap(), model);

            let (owner, _) = artifact.repository.split_once('/').unwrap();
            assert!(PUBLISHERS.contains(&owner), "{model}: {owner}");
            assert!(artifact.repository.ends_with("-GGUF"), "{model}");
            assert_eq!(artifact.revision.len(), 40, "{model}");
            assert!(
                artifact
                    .revision
                    .chars()
                    .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
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
            assert!(artifact.filename.ends_with("Q4_K_M.gguf"), "{model}");
            assert!(artifact.bytes > 1_000_000_000, "{model}");
            assert_eq!(
                artifact.download_url(),
                format!(
                    "https://huggingface.co/{}/resolve/{}/{}",
                    artifact.repository, artifact.revision, artifact.filename
                )
            );
            assert!(info.license.url.starts_with("https://"), "{model}");
            assert!(!info.license.attribution.is_empty(), "{model}");
            assert!(info.context_length >= 32_768, "{model}");
            assert!(info.kv_bytes_per_token > 0, "{model}");
        }
    }
}
