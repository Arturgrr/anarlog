use crate::{GgufArtifact, GgufModel, GgufModelInfo, License, TimestampGranularity};

const GIB: u64 = 1024 * 1024 * 1024;

const PARAKEET_V3_LANGUAGES: &[&str] = &[
    "bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "hu", "it", "lv", "lt", "mt",
    "pl", "pt", "ro", "ru", "sk", "sl", "es", "sv", "uk",
];
const QWEN_LANGUAGES: &[&str] = &[
    "zh", "en", "yue", "ar", "de", "fr", "es", "pt", "id", "it", "ko", "ru", "th", "vi", "ja",
    "tr", "hi", "ms", "nl", "sv", "da", "fi", "pl", "cs", "fil", "fa", "el", "ro", "hu", "mk",
];
const COHERE_LANGUAGES: &[&str] = &[
    "en", "fr", "de", "es", "it", "pt", "nl", "pl", "el", "ar", "ja", "zh", "vi", "ko",
];
const NEMOTRON_3_5_LANGUAGES: &[&str] = &[
    "en", "es", "fr", "de", "it", "pt", "nl", "tr", "ru", "uk", "pl", "cs", "sk", "bg", "hr", "ro",
    "hu", "sv", "da", "fi", "et", "ar", "hi", "ja", "ko", "zh", "vi",
];

/// Nemotron 3.5's language prompt takes these locales.
pub(crate) const NEMOTRON_3_5_LOCALES: &[(&str, &str)] = &[
    ("en", "en-US"),
    ("es", "es-ES"),
    ("fr", "fr-FR"),
    ("de", "de-DE"),
    ("it", "it-IT"),
    ("pt", "pt-BR"),
    ("nl", "nl-NL"),
    ("tr", "tr-TR"),
    ("ru", "ru-RU"),
    ("uk", "uk-UA"),
    ("pl", "pl-PL"),
    ("cs", "cs-CZ"),
    ("sk", "sk-SK"),
    ("bg", "bg-BG"),
    ("hr", "hr-HR"),
    ("ro", "ro-RO"),
    ("hu", "hu-HU"),
    ("sv", "sv-SE"),
    ("da", "da-DK"),
    ("fi", "fi-FI"),
    ("et", "et-EE"),
    ("ar", "ar-AR"),
    ("hi", "hi-IN"),
    ("ja", "ja-JP"),
    ("ko", "ko-KR"),
    ("zh", "zh-CN"),
    ("vi", "vi-VN"),
];

/// Whisper large-v3's language codes, for the `"*"` entry.
pub const WHISPER_LANGUAGES: &[&str] = &[
    "en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl", "ca", "nl", "ar", "sv", "it",
    "id", "hi", "fi", "vi", "he", "uk", "el", "ms", "cs", "ro", "da", "hu", "ta", "no", "th", "ur",
    "hr", "bg", "lt", "la", "mi", "ml", "cy", "sk", "te", "fa", "lv", "bn", "sr", "az", "sl", "kn",
    "et", "mk", "br", "eu", "is", "hy", "ne", "mn", "bs", "kk", "sq", "sw", "gl", "mr", "pa", "si",
    "km", "sn", "yo", "so", "af", "oc", "ka", "be", "tg", "sd", "gu", "am", "yi", "lo", "uz", "fo",
    "ht", "ps", "tk", "nn", "mt", "sa", "lb", "my", "bo", "tl", "mg", "as", "tt", "haw", "ln",
    "ha", "ba", "jw", "su", "yue", "fil",
];

const MIT_URL: &str = "https://opensource.org/license/mit";
const APACHE_URL: &str = "https://www.apache.org/licenses/LICENSE-2.0";
const CC_BY_4_URL: &str = "https://creativecommons.org/licenses/by/4.0/legalcode";

static WHISPER_LARGE_V3_TURBO: GgufModelInfo = GgufModelInfo {
    display_name: "Whisper large-v3-turbo",
    description: "OpenAI's multilingual model: about 100 languages with language detection.",
    artifact: GgufArtifact {
        repository: "handy-computer/whisper-large-v3-turbo-gguf",
        revision: "d222c9f621c1128299248f2ded4d8a1820519780",
        filename: "whisper-large-v3-turbo-Q8_0.gguf",
        bytes: 886_381_824,
        sha256: "d5e65f2b0828802ae2c231673d31982cebe3a778c95d9494a9f3efee6bd17448",
        architecture: "whisper",
        variant: "whisper-large-v3-turbo",
    },
    languages: &["*"],
    detects_language: true,
    accepts_language_hint: true,
    forced_language: None,
    timestamps: TimestampGranularity::Segment,
    // openai/whisper-large-v3-turbo at 41f01f3, the commit converted, is MIT.
    // The GGUF card reads Apache-2.0 "inherited from the base model".
    license: License {
        spdx: Some("MIT"),
        name: "MIT License",
        url: MIT_URL,
        attribution: "Whisper large-v3-turbo by OpenAI, MIT License. GGUF conversion and \
                      Q8_0 quantization by handy-computer for transcribe.cpp.",
    },
    recommended_memory_bytes: 8 * GIB,
};

static PARAKEET_TDT_V3: GgufModelInfo = GgufModelInfo {
    display_name: "Parakeet TDT 0.6B v3",
    description: "NVIDIA's fast model for 25 European languages, with word timestamps.",
    artifact: GgufArtifact {
        repository: "handy-computer/parakeet-tdt-0.6b-v3-gguf",
        revision: "85ac09ea12fc4b1112fa76810059364bc6adc9de",
        filename: "parakeet-tdt-0.6b-v3-Q8_0.gguf",
        bytes: 739_508_576,
        sha256: "5859f77944efcd8eafa23a6350731960b2b55b2203df51f319665c807d802cc7",
        architecture: "parakeet",
        variant: "tdt-0.6b-v3",
    },
    languages: PARAKEET_V3_LANGUAGES,
    // It finds the language in the audio and has no language input.
    detects_language: true,
    accepts_language_hint: false,
    forced_language: None,
    timestamps: TimestampGranularity::Word,
    license: License {
        spdx: Some("CC-BY-4.0"),
        name: "Creative Commons Attribution 4.0 International",
        url: CC_BY_4_URL,
        attribution: "Parakeet TDT 0.6B v3 by NVIDIA, licensed under CC BY 4.0. Converted to \
                      GGUF and quantized to Q8_0 by handy-computer; the weights were not \
                      retrained.",
    },
    recommended_memory_bytes: 8 * GIB,
};

static PARAKEET_ULTRA: GgufModelInfo = GgufModelInfo {
    display_name: "Parakeet Ultra",
    description: "Moondream's post-trained Parakeet v3 for 25 European languages, with word \
                  timestamps.",
    artifact: GgufArtifact {
        repository: "handy-computer/parakeet-ultra-gguf",
        revision: "a1539be1b849ea7463b88343e5277b373d0c4ea9",
        filename: "parakeet-ultra-Q8_0.gguf",
        bytes: 740_363_168,
        sha256: "007a59761e9258779f189df396b50d12b83bb5b79e66df4b955c230d2f2a0a59",
        architecture: "parakeet",
        variant: "tdt-0.6b-ultra",
    },
    languages: PARAKEET_V3_LANGUAGES,
    detects_language: true,
    accepts_language_hint: false,
    forced_language: None,
    timestamps: TimestampGranularity::Word,
    license: License {
        spdx: Some("CC-BY-4.0"),
        name: "Creative Commons Attribution 4.0 International",
        url: "https://huggingface.co/handy-computer/parakeet-ultra-gguf/blob/a1539be1b849ea7463b88343e5277b373d0c4ea9/LICENSE",
        attribution: "Parakeet Ultra by Moondream, based on NVIDIA Parakeet TDT 0.6B v3. GGUF \
                      conversion and quantization by handy-computer. Creative Commons \
                      Attribution 4.0 International (CC BY 4.0).",
    },
    recommended_memory_bytes: 8 * GIB,
};

static QWEN3_ASR_0_6B: GgufModelInfo = GgufModelInfo {
    display_name: "Qwen3-ASR 0.6B",
    description: "Alibaba's model for 30 languages, strong on Asian languages and mixed \
                  speech. No timestamps.",
    artifact: GgufArtifact {
        repository: "handy-computer/Qwen3-ASR-0.6B-gguf",
        revision: "e4e16599b900eb0cb36e524514756bb92eb092b7",
        filename: "Qwen3-ASR-0.6B-Q8_0.gguf",
        bytes: 850_423_456,
        sha256: "f081b2d5e23bd669d92cc331d722a8a0681943b8e6f34b48996fd5c319b5acd8",
        architecture: "qwen3_asr",
        variant: "qwen3-asr-0.6b",
    },
    languages: QWEN_LANGUAGES,
    detects_language: true,
    accepts_language_hint: true,
    forced_language: None,
    timestamps: TimestampGranularity::None,
    license: License {
        spdx: Some("Apache-2.0"),
        name: "Apache License 2.0",
        url: APACHE_URL,
        attribution: "Qwen3-ASR 0.6B by the Qwen team, Alibaba Cloud, licensed under the \
                      Apache License 2.0. GGUF conversion by handy-computer.",
    },
    recommended_memory_bytes: 8 * GIB,
};

static COHERE_TRANSCRIBE: GgufModelInfo = GgufModelInfo {
    display_name: "Cohere Transcribe",
    description: "Cohere Labs' most accurate model for 14 languages. Large download; no \
                  timestamps.",
    artifact: GgufArtifact {
        repository: "handy-computer/cohere-transcribe-03-2026-gguf",
        revision: "dfa4adebb64f3076b7b6b90b721275cc069cb421",
        filename: "cohere-transcribe-03-2026-Q8_0.gguf",
        bytes: 2_410_655_232,
        sha256: "931916663432fd895423a4291a8400221802b288967ca2d435fc5e3141c9e71e",
        architecture: "cohere_asr",
        variant: "cohere-transcribe-03-2026",
    },
    languages: COHERE_LANGUAGES,
    detects_language: false,
    accepts_language_hint: true,
    forced_language: None,
    timestamps: TimestampGranularity::None,
    license: License {
        spdx: Some("Apache-2.0"),
        name: "Apache License 2.0",
        url: APACHE_URL,
        attribution: "Cohere Transcribe (03-2026) by Cohere Labs, licensed under the Apache \
                      License 2.0. GGUF conversion by handy-computer.",
    },
    recommended_memory_bytes: 16 * GIB,
};

static GIGAAM_V3: GgufModelInfo = GgufModelInfo {
    display_name: "GigaAM v3",
    description: "A small, accurate Russian model with punctuation and word timestamps.",
    artifact: GgufArtifact {
        repository: "handy-computer/gigaam-v3-e2e-rnnt-gguf",
        revision: "3efd5b39882ceadca5570a8fb9fa1a2c801d6d6d",
        filename: "gigaam-v3-e2e-rnnt-Q8_0.gguf",
        bytes: 273_724_832,
        sha256: "78d63b47723b7f8d78c6113a6ef983b5a86e2a86f6c273e1f5cb6967b1c4467a",
        architecture: "gigaam",
        variant: "gigaam-v3-e2e-rnnt",
    },
    languages: &["ru"],
    detects_language: false,
    accepts_language_hint: false,
    forced_language: None,
    timestamps: TimestampGranularity::Word,
    license: License {
        spdx: Some("MIT"),
        name: "MIT License",
        url: "https://huggingface.co/handy-computer/gigaam-v3-e2e-rnnt-gguf/blob/3efd5b39882ceadca5570a8fb9fa1a2c801d6d6d/LICENSE",
        attribution: "GigaAM v3 (e2e RNN-T) by the GigaChat Team, MIT License, Copyright (c) \
                      2024 GigaChat Team. GGUF conversion by handy-computer.",
    },
    recommended_memory_bytes: 8 * GIB,
};

static NB_WHISPER_MEDIUM: GgufModelInfo = GgufModelInfo {
    display_name: "NB-Whisper Medium",
    description: "The National Library of Norway's Whisper for Norwegian.",
    artifact: GgufArtifact {
        repository: "NbAiLab/nb-whisper-medium",
        revision: "0ed074d5985bd56ca4140159a9dbffbc3fb5117e",
        filename: "ggml-model-q5_0.bin",
        bytes: 539_212_484,
        sha256: "18733de634af639a43b0f8c5f5a2ea0920de4c5b32a5570ec130981581c0e5e7",
        architecture: "whisper",
        // transcribe.cpp names a whisper.cpp file by its geometry.
        variant: "whisper-medium",
    },
    languages: &["no"],
    detects_language: false,
    accepts_language_hint: true,
    forced_language: Some("no"),
    timestamps: TimestampGranularity::Segment,
    license: License {
        spdx: Some("Apache-2.0"),
        name: "Apache License 2.0",
        url: APACHE_URL,
        attribution: "NB-Whisper Medium by the National Library of Norway, licensed under the \
                      Apache License 2.0, fine-tuned from OpenAI Whisper medium (MIT). \
                      whisper.cpp file published by NbAiLab.",
    },
    recommended_memory_bytes: 8 * GIB,
};

static IVRIT_WHISPER_LARGE_V3_TURBO: GgufModelInfo = GgufModelInfo {
    display_name: "ivrit.ai Whisper large-v3-turbo",
    description: "ivrit.ai's Whisper fine-tune for Hebrew.",
    artifact: GgufArtifact {
        repository: "adolan/ivrit-whisper-large-v3-turbo-gguf",
        revision: "a12befaff80add995ac6a8fe10cbb7f38438c7b5",
        filename: "ivrit-whisper-large-v3-turbo-Q8_0.gguf",
        bytes: 886_381_536,
        sha256: "23756afa3d3c52cd3cb55e259c8373373eba6d19c3858a67531ba2772b7f272f",
        architecture: "whisper",
        variant: "ivrit-whisper-large-v3-turbo",
    },
    languages: &["he"],
    // The fine-tune lost language detection, so it always gets Hebrew.
    detects_language: false,
    accepts_language_hint: true,
    forced_language: Some("he"),
    timestamps: TimestampGranularity::Segment,
    license: License {
        spdx: Some("Apache-2.0"),
        name: "Apache License 2.0",
        url: APACHE_URL,
        attribution: "ivrit.ai Whisper large-v3-turbo by ivrit.ai, licensed under the Apache \
                      License 2.0, fine-tuned from OpenAI Whisper large-v3-turbo (MIT). GGUF \
                      conversion by adolan.",
    },
    recommended_memory_bytes: 8 * GIB,
};

static NEMOTRON_3_5_ASR: GgufModelInfo = GgufModelInfo {
    display_name: "Nemotron 3.5 ASR",
    description: "NVIDIA's model for 27 languages, with word timestamps.",
    artifact: GgufArtifact {
        repository: "handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf",
        revision: "53ce288f69326b415aeef030cfcb02a08a8096dd",
        filename: "nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf",
        bytes: 751_094_240,
        sha256: "b94545b313b3223fda7b2857a52681da813935c2127643d1e9ff0c23d988089c",
        architecture: "parakeet",
        variant: "nemotron-3.5-asr-streaming-0.6b",
    },
    languages: NEMOTRON_3_5_LANGUAGES,
    detects_language: true,
    accepts_language_hint: true,
    forced_language: None,
    timestamps: TimestampGranularity::Word,
    license: License {
        // Not on the SPDX list.
        spdx: None,
        name: "OpenMDW License Agreement 1.1",
        url: "https://huggingface.co/handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/blob/53ce288f69326b415aeef030cfcb02a08a8096dd/LICENSE",
        attribution: "Nemotron 3.5 ASR Streaming 0.6B by NVIDIA, licensed under OpenMDW-1.1. \
                      Converted to GGUF and quantized to Q8_0 by handy-computer; the weights \
                      were not retrained.",
    },
    recommended_memory_bytes: 8 * GIB,
};

pub(crate) fn info(model: GgufModel) -> &'static GgufModelInfo {
    match model {
        GgufModel::WhisperLargeV3Turbo => &WHISPER_LARGE_V3_TURBO,
        GgufModel::ParakeetTdtV3 => &PARAKEET_TDT_V3,
        GgufModel::ParakeetUltra => &PARAKEET_ULTRA,
        GgufModel::Qwen3Asr06B => &QWEN3_ASR_0_6B,
        GgufModel::CohereTranscribe => &COHERE_TRANSCRIBE,
        GgufModel::GigaAmV3 => &GIGAAM_V3,
        GgufModel::NbWhisperMedium => &NB_WHISPER_MEDIUM,
        GgufModel::IvritWhisperLargeV3Turbo => &IVRIT_WHISPER_LARGE_V3_TURBO,
        GgufModel::Nemotron35Asr => &NEMOTRON_3_5_ASR,
    }
}
