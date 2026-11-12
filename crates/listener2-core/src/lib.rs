mod batch;
mod error;
mod events;
mod runtime;
mod subtitle;

pub use batch::{
    BatchParams, BatchProvider, BatchRunMode, BatchRunOutput, KnownSpeaker,
    expects_progressive_batch, run_batch, uses_local_diarization,
};
pub use error::*;
pub use events::*;
pub use runtime::*;
pub use subtitle::*;

use std::str::FromStr;

use owhisper_client::AdapterKind;

// whisper.cpp files have no remote adapter; their language support comes from the
// on-device runtime.
const LOCAL_FILE_PROVIDER: &str = "local_file";
// transcribe.cpp catalog models run in the internal server, after recording only;
// their languages come from the catalog, in either mode. Settings asks with the
// `gguf` provider, batch callers with its `whispercpp` batch provider.
const GGUF_PROVIDER: &str = "gguf";
const WHISPERCPP_BATCH_PROVIDER: &str = "whispercpp";

fn is_gguf_request(provider: &str, model: Option<&str>) -> bool {
    provider == GGUF_PROVIDER
        || (provider == WHISPERCPP_BATCH_PROVIDER
            && model.is_some_and(|model| model.parse::<anlg_gguf_model::GgufModel>().is_ok()))
}

fn gguf_supports_languages(
    model: Option<&str>,
    languages: &[anlg_language::Language],
) -> std::result::Result<bool, String> {
    let model = model
        .ok_or_else(|| "missing_model: gguf".to_string())?
        .parse::<anlg_gguf_model::GgufModel>()
        .map_err(|e| e.to_string())?;

    Ok(languages
        .iter()
        .all(|language| model.supports_language(language.iso639_code())))
}

pub fn is_supported_languages_live(
    provider: &str,
    model: Option<&str>,
    languages: &[anlg_language::Language],
) -> std::result::Result<bool, String> {
    if provider == "custom" {
        return Ok(true);
    }

    if provider == "soniqo" {
        let model = model
            .ok_or_else(|| "missing_model: soniqo".to_string())?
            .parse::<anlg_transcribe_soniqo::SoniqoModel>()
            .map_err(|e| e.to_string())?;

        return Ok(model.supports_live_on_current_platform() && model.supports_languages(languages));
    }

    if provider == "apple-speech" {
        let model = model
            .ok_or_else(|| "missing_model: apple-speech".to_string())?
            .parse::<anlg_transcribe_speechanalyzer::AppleSpeechModel>()
            .map_err(|e| e.to_string())?;

        return Ok(model.supports_live_on_current_platform() && model.supports_languages(languages));
    }

    if provider == LOCAL_FILE_PROVIDER {
        return Ok(model.is_none_or(|model| !model.starts_with("whisper-")));
    }

    if is_gguf_request(provider, model) {
        return gguf_supports_languages(model, languages);
    }

    let adapter_kind =
        AdapterKind::from_str(provider).map_err(|_| format!("unknown_provider: {}", provider))?;

    Ok(adapter_kind.is_supported_languages_live(languages, model))
}

pub fn is_supported_languages_batch(
    provider: &str,
    model: Option<&str>,
    languages: &[anlg_language::Language],
) -> std::result::Result<bool, String> {
    if provider == "custom" {
        return Ok(true);
    }

    if provider == "soniqo" {
        let model = model
            .ok_or_else(|| "missing_model: soniqo".to_string())?
            .parse::<anlg_transcribe_soniqo::SoniqoModel>()
            .map_err(|e| e.to_string())?;

        return Ok(model.supports_languages(languages));
    }

    if provider == "apple-speech" {
        let model = model
            .ok_or_else(|| "missing_model: apple-speech".to_string())?
            .parse::<anlg_transcribe_speechanalyzer::AppleSpeechModel>()
            .map_err(|e| e.to_string())?;

        return Ok(model.supports_languages(languages));
    }

    if provider == LOCAL_FILE_PROVIDER {
        return Ok(true);
    }

    if is_gguf_request(provider, model) {
        return gguf_supports_languages(model, languages);
    }

    let adapter_kind =
        AdapterKind::from_str(provider).map_err(|_| format!("unknown_provider: {}", provider))?;

    Ok(adapter_kind.is_supported_languages_batch(languages, model))
}

pub fn suggest_providers_for_languages_live(languages: &[anlg_language::Language]) -> Vec<String> {
    let all_providers = [
        AdapterKind::Soniox,
        AdapterKind::Fireworks,
        AdapterKind::Deepgram,
        AdapterKind::AssemblyAI,
        AdapterKind::OpenAI,
        AdapterKind::Gladia,
        AdapterKind::ElevenLabs,
        AdapterKind::DashScope,
        AdapterKind::Mistral,
        AdapterKind::Meta,
        AdapterKind::Xai,
        AdapterKind::Nari,
        AdapterKind::SmallestAI,
        AdapterKind::WisprFlow,
        AdapterKind::GoogleGenerativeAi,
    ];

    let mut with_support: Vec<_> = all_providers
        .iter()
        .map(|kind| {
            let support = kind.language_support_live(languages, None);
            (*kind, support)
        })
        .filter(|(_, support)| support.is_supported())
        .collect();

    with_support.sort_by(|(_, s1), (_, s2)| s2.cmp(s1));

    with_support
        .into_iter()
        .map(|(kind, _)| kind.to_string())
        .collect()
}

pub fn suggest_providers_for_languages_batch(languages: &[anlg_language::Language]) -> Vec<String> {
    let all_providers = [
        AdapterKind::Soniox,
        AdapterKind::Fireworks,
        AdapterKind::Deepgram,
        AdapterKind::AssemblyAI,
        AdapterKind::OpenAI,
        AdapterKind::OpenRouter,
        AdapterKind::SiliconFlow,
        AdapterKind::Zai,
        AdapterKind::Gladia,
        AdapterKind::ElevenLabs,
        AdapterKind::DashScope,
        AdapterKind::Mistral,
        AdapterKind::Meta,
        AdapterKind::Cohere,
        AdapterKind::AwsTranscribe,
        AdapterKind::AzureSpeech,
        AdapterKind::GoogleCloud,
        AdapterKind::GoogleGenerativeAi,
        AdapterKind::Groq,
        AdapterKind::RevAi,
        AdapterKind::Speechmatics,
        AdapterKind::Together,
        AdapterKind::Xai,
        AdapterKind::SmallestAI,
        AdapterKind::WisprFlow,
    ];

    let mut with_support: Vec<_> = all_providers
        .iter()
        .map(|kind| {
            let support = kind.language_support_batch(languages, None);
            (*kind, support)
        })
        .filter(|(_, support)| support.is_supported())
        .collect();

    with_support.sort_by(|(_, s1), (_, s2)| s2.cmp(s1));

    with_support
        .into_iter()
        .map(|(kind, _)| kind.to_string())
        .collect()
}

pub fn list_documented_language_codes_batch() -> Vec<String> {
    owhisper_client::documented_language_codes_batch()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_language_support_by_provider_and_model() {
        let cases: &[(&str, &str, &[&str], bool)] = &[
            ("soniqo", "soniqo-parakeet-batch", &["fr"], true),
            ("soniqo", "soniqo-parakeet-batch", &["ko"], false),
            ("soniqo", "soniqo-omnilingual", &["fr"], true),
            ("local_file", "local-file", &["ko"], true),
            ("gguf", "gguf-parakeet-tdt-0.6b-v3", &["pt-BR", "en"], true),
            ("gguf", "gguf-parakeet-tdt-0.6b-v3", &["ko"], false),
            ("gguf", "gguf-whisper-large-v3-turbo", &["ko", "he"], true),
            ("gguf", "gguf-qwen3-asr-0.6b", &["fil"], true),
            ("whispercpp", "gguf-gigaam-v3", &["ru"], true),
            ("whispercpp", "gguf-gigaam-v3", &["en"], false),
            ("mistral", "voxtral-mini-2602", &["de-DE", "en-US"], true),
        ];

        for (provider, model, language_codes, expected) in cases {
            let languages = language_codes
                .iter()
                .map(|language| language.parse().unwrap())
                .collect::<Vec<_>>();
            assert_eq!(
                is_supported_languages_batch(provider, Some(model), &languages).unwrap(),
                *expected,
                "{provider}/{model}"
            );
        }
    }

    #[test]
    fn live_language_support_by_provider_and_model() {
        let cases: &[(&str, &str, &[&str], bool)] = &[
            ("soniqo", "soniqo-parakeet-streaming", &["ko"], false),
            (
                "soniqo",
                "soniqo-parakeet-streaming",
                &["fr"],
                cfg!(all(target_os = "macos", target_arch = "aarch64")),
            ),
            ("local_file", "local-file", &["ko"], true),
        ];

        for (provider, model, language_codes, expected) in cases {
            let languages = language_codes
                .iter()
                .map(|language| language.parse().unwrap())
                .collect::<Vec<_>>();
            assert_eq!(
                is_supported_languages_live(provider, Some(model), &languages).unwrap(),
                *expected,
                "{provider}/{model}"
            );
        }
    }

    #[test]
    fn meta_is_suggested_for_documented_languages() {
        let english = vec!["en-US".parse().unwrap()];
        let swahili = vec!["sw".parse().unwrap()];

        assert!(suggest_providers_for_languages_live(&english).contains(&"meta".to_string()));
        assert!(!suggest_providers_for_languages_live(&swahili).contains(&"meta".to_string()));
        assert!(suggest_providers_for_languages_batch(&english).contains(&"meta".to_string()));
        assert!(!suggest_providers_for_languages_batch(&swahili).contains(&"meta".to_string()));
    }

    #[test]
    fn apple_speech_language_support_reflects_installed_framework() {
        // Drives the settings warning that names unsupported spoken languages.
        let available = anlg_transcribe_speechanalyzer::availability()
            .is_ok_and(|value| value.status == "available");
        if !available {
            return;
        }

        let korean = vec!["ko".parse().unwrap()];
        let hindi = vec!["hi".parse().unwrap()];

        assert!(
            is_supported_languages_live("apple-speech", Some("apple-speech"), &korean).unwrap()
        );
        assert!(
            !is_supported_languages_live("apple-speech", Some("apple-speech"), &hindi).unwrap()
        );
        assert!(
            is_supported_languages_batch("apple-speech", Some("apple-speech"), &korean).unwrap()
        );
        assert!(
            !is_supported_languages_batch("apple-speech", Some("apple-speech"), &hindi).unwrap()
        );
    }
}
