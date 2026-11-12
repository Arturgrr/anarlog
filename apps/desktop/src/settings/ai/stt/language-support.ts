import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useQueries } from "@tanstack/react-query";

import type { SttMode } from "./catalog";
import { getLanguageSupportIssue } from "./selection";

import { getBaseLanguageDisplayName } from "~/settings/general/language";
import { useConfigValues } from "~/shared/config";
import {
  getTranscriptionLanguages,
  isSupportedLanguagesBatch,
  isSupportedLanguagesLive,
  modelCoversLanguages,
} from "~/stt/capabilities";

export type LanguageSupport = {
  supported: boolean;
  unsupportedLanguages: string[];
};

type LanguageSupportTarget = {
  provider: string;
  model: string;
  mode: SttMode;
  // A catalog model's own language list, checked here instead of by provider.
  modelLanguages?: readonly string[];
};

export function languageSupportKey(provider: string, model: string) {
  return `${provider}:${model}`;
}

export function useTranscriptionLanguages() {
  const { ai_language, spoken_languages } = useConfigValues([
    "ai_language",
    "spoken_languages",
  ] as const);

  return getTranscriptionLanguages(ai_language, spoken_languages);
}

export function useSttLanguageSupport(
  targets: readonly LanguageSupportTarget[],
): Map<string, LanguageSupport> {
  const { ai_language, spoken_languages } = useConfigValues([
    "ai_language",
    "spoken_languages",
  ] as const);

  return useQueries({
    queries: targets.map(({ provider, model, mode, modelLanguages }) => ({
      queryKey: [
        "stt-language-support",
        provider,
        model,
        mode === "live",
        ai_language,
        spoken_languages,
      ],
      queryFn: async (): Promise<LanguageSupport> => {
        const isSupported = async (languages: readonly string[]) =>
          modelLanguages
            ? modelCoversLanguages(modelLanguages, languages)
            : mode === "live"
              ? isSupportedLanguagesLive(provider, model || null, languages)
              : isSupportedLanguagesBatch(provider, model || null, languages);
        const issue = await getLanguageSupportIssue(
          ai_language,
          spoken_languages,
          isSupported,
        );

        return issue
          ? {
              supported: false,
              unsupportedLanguages: issue.unsupportedLanguages,
            }
          : { supported: true, unsupportedLanguages: [] };
      },
      enabled: !!ai_language,
      staleTime: Infinity,
    })),
    combine: (results) =>
      new Map(
        results.flatMap((result, index) => {
          const target = targets[index];
          return result.data && target
            ? [
                [
                  languageSupportKey(target.provider, target.model),
                  result.data,
                ] as const,
              ]
            : [];
        }),
      ),
  });
}

export function formatLanguageList(languages: readonly string[], i18n: I18n) {
  const names = languages.map((language) =>
    getBaseLanguageDisplayName(language, i18n.locale),
  );
  const visible = names.slice(0, 3);
  const remainingCount = names.length - visible.length;
  if (remainingCount > 0) {
    visible.push(i18n._(msg`${remainingCount} more`));
  }

  return visible.join(", ");
}
