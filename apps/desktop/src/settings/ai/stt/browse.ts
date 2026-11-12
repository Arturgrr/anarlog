import {
  type SttMode,
  type SttModelEntry,
  type SttProviderGroup,
  type SttProviderStatus,
  sttModelMode,
  sttProviderGroup,
  usesFreeformSttModel,
} from "./catalog";
import type { LanguageSupport } from "./language-support";
import { displayModelLabel, PROVIDERS } from "./shared";

import {
  matchesSearch,
  normalizeSearch,
  providerMatchesSearch,
} from "~/settings/ai/shared/provider-search";

type SttProvider = (typeof PROVIDERS)[number];

export type SttFilters = {
  where: "all" | SttProviderGroup;
  mode: SttMode | null;
  transcribesMyLanguages: boolean;
};

export const NO_STT_FILTERS: SttFilters = {
  where: "all",
  mode: null,
  transcribesMyLanguages: false,
};

export type SttEntry = {
  provider: SttProvider;
  status: SttProviderStatus;
  models: SttModelEntry[];
};

// Self-hosted providers take a model id instead of a catalogue, so the id they
// would use stands in as their only model for filtering and language checks.
export function sttEntryModels(
  providerId: string,
  status: SttProviderStatus,
  freeformModel: string,
): SttModelEntry[] {
  if (!usesFreeformSttModel(providerId)) {
    return status.models;
  }

  return [
    {
      id: freeformModel,
      isDownloaded: true,
      isDeprecated: false,
      recommended: null,
      mode: sttModelMode(providerId, freeformModel),
    },
  ];
}

export function hasActiveSttFilters(search: string, filters: SttFilters) {
  return (
    !!normalizeSearch(search) ||
    filters.where !== "all" ||
    filters.mode !== null ||
    filters.transcribesMyLanguages
  );
}

export function browseSttEntries(
  entries: readonly SttEntry[],
  search: string,
  filters: SttFilters,
  languageSupport: (
    provider: string,
    model: string,
  ) => LanguageSupport | undefined,
): SttEntry[] {
  const query = normalizeSearch(search);

  return entries.flatMap((entry) => {
    if (
      filters.where !== "all" &&
      sttProviderGroup(entry.provider.id) !== filters.where
    ) {
      return [];
    }

    const providerMatches = providerMatchesSearch(entry.provider, query);
    const models = entry.models.filter(
      (model) =>
        (providerMatches ||
          matchesSearch(
            query,
            model.id,
            displayModelLabel(model.id, model.displayName),
          )) &&
        (!filters.mode || model.mode === filters.mode) &&
        (!filters.transcribesMyLanguages ||
          languageSupport(entry.provider.id, model.id)?.supported !== false),
    );
    const showsWithoutModels =
      providerMatches &&
      entry.models.length === 0 &&
      !filters.mode &&
      !filters.transcribesMyLanguages;

    return models.length > 0 || showsWithoutModels
      ? [{ ...entry, models }]
      : [];
  });
}
