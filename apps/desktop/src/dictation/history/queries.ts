import { t } from "@lingui/core/macro";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { arch, platform } from "@tauri-apps/plugin-os";
import { useRef } from "react";

import { commands as dictation } from "@anlg/plugin-dictation";

import {
  DICTATION_COLUMNS,
  type DictationEntry,
  type DictationRow,
  mapDictationRow,
  replaceDictationText,
} from "./store";

import { useLiveQuery } from "~/db";
import { displayModelLabel } from "~/settings/ai/stt/shared";
import { useConfigValues } from "~/shared/config";
import {
  getTranscriptionLanguages,
  isDesktopLocalSttAvailable,
  isSupportedLanguagesBatch,
} from "~/stt/capabilities";
import { localSttQueries } from "~/stt/useLocalSttModel";
import { getBatchProvider, useRunBatch } from "~/stt/useRunBatch";
import { useSTTConnection } from "~/stt/useSTTConnection";

const EMPTY: DictationEntry[] = [];

/** Newest first, `limit` at a time; the search matches the texts, the app and the model. */
export function useDictationHistory(search: string, limit: number) {
  const needle = search.trim().toLowerCase();
  const { data } = useLiveQuery<DictationRow, DictationEntry[]>({
    sql: `
      SELECT ${DICTATION_COLUMNS}
      FROM dictation_history
      WHERE ? = '' OR instr(lower(
        raw_text || char(10) || final_text || char(10) ||
        COALESCE(target_app_name, '') || char(10) || COALESCE(model, '')
      ), ?) > 0
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    params: [needle, needle, limit + 1],
    mapRows: (rows) => rows.map(mapDictationRow),
  });
  // Keep showing the last rows while a new search or page loads.
  const held = useRef<DictationEntry[] | undefined>(undefined);
  if (data !== undefined) held.current = data;
  const entries = data ?? held.current;

  return {
    entries: entries?.slice(0, limit) ?? EMPTY,
    hasMore: (entries?.length ?? 0) > limit,
    isLoading: entries === undefined,
  };
}

type RetranscriptionModel = {
  provider: string;
  model: string;
  label: string;
  baseUrl: string;
  apiKey: string;
};

const LOCAL_PROVIDERS = { soniqo: "soniqo", appleSpeech: "apple_speech" };

/**
 * The models a kept recording can be transcribed with: the selected one,
 * and the on-device models installed here, when they take the languages
 * dictation transcribes.
 */
export function useRetranscriptionModels() {
  const { conn } = useSTTConnection();
  const { ai_language, spoken_languages } = useConfigValues([
    "ai_language",
    "spoken_languages",
  ] as const);
  const languages = getTranscriptionLanguages(ai_language, spoken_languages);
  const onDevice = isDesktopLocalSttAvailable(platform(), arch());
  const supported = useQuery({
    ...localSttQueries.supportedModels(),
    enabled: onDevice,
  });
  const localModels = onDevice
    ? (supported.data ?? []).flatMap((model) => {
        const provider =
          LOCAL_PROVIDERS[model.model_type as keyof typeof LOCAL_PROVIDERS];
        return provider
          ? [{ provider, model: model.key, label: model.display_name }]
          : [];
      })
    : [];
  const downloaded = useQueries({
    queries: localModels.map((model) => ({
      ...localSttQueries.isDownloaded(model.model),
      enabled: onDevice,
    })),
  });

  const candidates: RetranscriptionModel[] = [];
  if (conn && getBatchProvider(conn.provider, conn.model)) {
    candidates.push({
      provider: conn.provider,
      model: conn.model,
      label: displayModelLabel(conn.model),
      baseUrl: conn.baseUrl,
      apiKey: conn.apiKey,
    });
  }
  localModels.forEach((model, index) => {
    if (
      downloaded[index]?.data === true &&
      !candidates.some((candidate) => candidate.model === model.model)
    ) {
      candidates.push({ ...model, baseUrl: "", apiKey: "" });
    }
  });

  const usable = useQuery({
    enabled: candidates.length > 0,
    queryKey: [
      "dictation-history",
      "retranscription-models",
      candidates.map(({ provider, model }) => `${provider}:${model}`),
      languages,
    ],
    queryFn: async () => {
      const checks = await Promise.all(
        candidates.map(async ({ provider, model }) => {
          const batch = getBatchProvider(provider, model);
          return batch &&
            (await isSupportedLanguagesBatch(batch, model, languages))
            ? `${provider}:${model}`
            : null;
        }),
      );
      return checks.filter((key) => key !== null);
    },
  });

  return {
    models: candidates.filter(({ provider, model }) =>
      usable.data?.includes(`${provider}:${model}`),
    ),
    isLoading:
      usable.isLoading ||
      supported.isLoading ||
      downloaded.some((query) => query.isLoading),
  };
}

function wordsToText(words: { text: string; start_ms: number }[]) {
  return words
    .slice()
    .sort((a, b) => a.start_ms - b.start_ms)
    .map((word) => word.text)
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Transcribes an entry's kept audio again with `model`, through the batch path dictation uses. */
export function useRetranscribe() {
  const sessionId = useRef(`dictation-history-${crypto.randomUUID()}`).current;
  const runBatch = useRunBatch(sessionId);

  return useMutation({
    mutationFn: async ({
      entry,
      model,
    }: {
      entry: DictationEntry;
      model: RetranscriptionModel;
    }) => {
      if (!entry.audioPath) throw new Error(t`This dictation has no audio.`);
      const path = await dictation.historyAudioPath(entry.audioPath);
      if (path.status === "error") {
        throw new Error(t`The audio of this dictation is no longer available.`);
      }
      let text = "";
      const used = await runBatch(path.data, {
        provider: model.provider,
        model: model.model,
        baseUrl: model.baseUrl,
        apiKey: model.apiKey,
        deferAudioFinalization: true,
        notifyOnCompletion: false,
        numSpeakers: 1,
        handlePersist: (words) => {
          text = wordsToText(words);
        },
      });
      if (!text) throw new Error(t`No speech detected. Please try again.`);
      await replaceDictationText(entry.id, {
        text,
        provider: used.provider,
        model: used.model,
        language: entry.language,
      });
    },
  });
}
