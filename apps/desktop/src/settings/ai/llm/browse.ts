import { llmModelReadsImages, type LlmModelList } from "./model-lists";
import type { Provider } from "./shared";
import { isSubscriptionProviderId } from "./subscriptions";

import { displayLlmModelId } from "~/settings/ai/shared/model-display";
import {
  matchesSearch,
  normalizeSearch,
  providerMatchesSearch,
} from "~/settings/ai/shared/provider-search";

export type LlmProviderGroup = "local" | "subscription" | "api" | "custom";

export type LlmFilters = {
  where: "all" | "local" | "subscription" | "api";
  readsImages: boolean;
};

export const NO_LLM_FILTERS: LlmFilters = { where: "all", readsImages: false };

const LOCAL_PROVIDERS: readonly string[] = [
  "builtin",
  "apple_foundation",
  "ollama",
  "lmstudio",
  "unsloth",
];

export function llmProviderGroup(provider: Provider): LlmProviderGroup {
  if (LOCAL_PROVIDERS.includes(provider.id)) return "local";
  if (
    provider.authKind === "subscription" ||
    isSubscriptionProviderId(provider.id)
  )
    return "subscription";
  if (provider.id === "custom") return "custom";
  return "api";
}

export function hasActiveLlmFilters(search: string, filters: LlmFilters) {
  return (
    !!normalizeSearch(search) || filters.where !== "all" || filters.readsImages
  );
}

export type LlmEntry = {
  provider: Provider;
  list?: LlmModelList;
  models: string[];
};

export function browseLlmEntries(
  providers: readonly Provider[],
  lists: Record<string, LlmModelList>,
  search: string,
  filters: LlmFilters,
): LlmEntry[] {
  const query = normalizeSearch(search);

  return providers.flatMap((provider) => {
    const group = llmProviderGroup(provider);
    if (
      filters.where !== "all" &&
      group !== filters.where &&
      !(filters.where === "api" && group === "custom")
    ) {
      return [];
    }

    const list = lists[provider.id];
    const allModels = list?.result?.models ?? [];
    const providerMatches = providerMatchesSearch(provider, query);
    const models = allModels.filter(
      (model) =>
        (providerMatches ||
          matchesSearch(query, model, displayLlmModelId(model))) &&
        (!filters.readsImages ||
          llmModelReadsImages(
            provider.id,
            model,
            list?.result?.metadata[model],
          )),
    );
    const visible =
      models.length > 0 || (providerMatches && !filters.readsImages);

    return visible ? [{ provider, list, models }] : [];
  });
}
