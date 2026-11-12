export type OnDeviceModelCandidate = {
  id: string;
  recommendedMemoryBytes: number;
};

export function recommendOnDeviceModel(
  models: readonly OnDeviceModelCandidate[],
  totalMemoryBytes?: number | null,
) {
  if (models.length === 0) {
    return null;
  }

  const memoryBytes =
    totalMemoryBytes && Number.isFinite(totalMemoryBytes)
      ? totalMemoryBytes
      : 0;
  const fittingModels = models.filter(
    (model) => model.recommendedMemoryBytes <= memoryBytes,
  );
  const candidates = fittingModels.length > 0 ? fittingModels : models;

  return candidates.reduce((recommended, model) => {
    if (fittingModels.length > 0) {
      return model.recommendedMemoryBytes > recommended.recommendedMemoryBytes
        ? model
        : recommended;
    }

    return model.recommendedMemoryBytes < recommended.recommendedMemoryBytes
      ? model
      : recommended;
  }).id;
}

const WHISPER_TURBO = "gguf-whisper-large-v3-turbo";
const PARAKEET_V3 = "gguf-parakeet-tdt-0.6b-v3";
const QWEN3_ASR = "gguf-qwen3-asr-0.6b";
const COHERE = "gguf-cohere-transcribe";
const GIGAAM = "gguf-gigaam-v3";
const NB_WHISPER = "gguf-nb-whisper-medium";
const IVRIT_WHISPER = "gguf-ivrit-whisper-large-v3-turbo";

// Hex's picks per spoken language (src/transcription/models.rs), best first,
// without the models Librelog does not offer (Parakeet Unified English and
// SenseVoice Small).
const GGUF_CHOICES_BY_LANGUAGE = new Map<string, readonly string[]>([
  ["en", [COHERE, WHISPER_TURBO]],
  ["zh", [QWEN3_ASR, WHISPER_TURBO]],
  ["yue", [QWEN3_ASR, WHISPER_TURBO]],
  ["ko", [QWEN3_ASR, WHISPER_TURBO]],
  ["ja", [WHISPER_TURBO]],
  ["el", [COHERE, WHISPER_TURBO]],
  ["fi", [WHISPER_TURBO, PARAKEET_V3]],
  ["sv", [WHISPER_TURBO, PARAKEET_V3]],
  ["da", [WHISPER_TURBO, PARAKEET_V3]],
  ["mt", [PARAKEET_V3]],
  ["ar", [WHISPER_TURBO, COHERE]],
  ["tr", [WHISPER_TURBO]],
  ["ms", [WHISPER_TURBO]],
  ["tl", [WHISPER_TURBO]],
  ["fa", [WHISPER_TURBO]],
  ["mk", [WHISPER_TURBO]],
  ["he", [IVRIT_WHISPER, WHISPER_TURBO]],
  ["ru", [GIGAAM, WHISPER_TURBO]],
  ["no", [NB_WHISPER, WHISPER_TURBO]],
  ["vi", [QWEN3_ASR, COHERE, WHISPER_TURBO]],
]);

type LanguageModelCandidate = { id: string; languages: readonly string[] };

// Ranking only: whether a model can transcribe the languages is answered by
// the transcription plugin from the same catalog. These are the spellings
// that differ between Settings and the catalog, as the plugin maps them.
const CATALOG_LANGUAGE_ALIASES = new Map([
  ["nb", "no"],
  ["fil", "tl"],
]);

function catalogLanguageCode(language: string) {
  const code = language.split(/[-_]/)[0]?.toLowerCase() ?? "";
  return CATALOG_LANGUAGE_ALIASES.get(code) ?? code;
}

function modelCoversLanguages(
  modelLanguages: readonly string[],
  languages: readonly string[],
) {
  if (modelLanguages.includes("*")) {
    return true;
  }

  const covered = new Set(modelLanguages.map(catalogLanguageCode));
  return languages.every((language) =>
    covered.has(catalogLanguageCode(language)),
  );
}

function choicesForLanguage(
  language: string | undefined,
  models: readonly LanguageModelCandidate[],
) {
  if (!language) {
    return [WHISPER_TURBO, QWEN3_ASR];
  }

  const code = catalogLanguageCode(language);
  const listed = GGUF_CHOICES_BY_LANGUAGE.get(code);
  if (listed) {
    return listed;
  }

  const speaks = (id: string) =>
    models.some(
      (model) =>
        model.id === id && modelCoversLanguages(model.languages, [code]),
    );
  if (speaks(PARAKEET_V3)) {
    return [PARAKEET_V3, WHISPER_TURBO];
  }
  if (speaks(QWEN3_ASR)) {
    return [QWEN3_ASR, WHISPER_TURBO];
  }
  return [WHISPER_TURBO];
}

/// Orders downloadable models for the spoken languages, the first language
/// leading: its picks that cover every language, then the other models that
/// cover them, then the rest. Models missing from the catalog are skipped.
export function rankModelsForLanguages(
  models: readonly LanguageModelCandidate[],
  languages: readonly string[],
) {
  const coversAll = (model: LanguageModelCandidate) =>
    modelCoversLanguages(model.languages, languages);
  const picks = choicesForLanguage(languages[0], models).flatMap((id) =>
    models.filter((model) => model.id === id && coversAll(model)),
  );
  const others = models.filter((model) => !picks.includes(model));

  return {
    recommended: picks[0]?.id ?? null,
    order: [
      ...picks,
      ...others.filter(coversAll),
      ...others.filter((model) => !coversAll(model)),
    ].map((model) => model.id),
  };
}
