import { t } from "@lingui/core/macro";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { arch, platform } from "@tauri-apps/plugin-os";
import { useRef } from "react";

import { commands as dictation } from "@anlg/plugin-dictation";
import {
  commands as localSttCommands,
  type SttModelType,
} from "@anlg/plugin-local-stt";

import {
  DICTATION_COLUMNS,
  type DictationEntry,
  type DictationRow,
  mapDictationRow,
  replaceDictationText,
} from "./store";

import { useLiveQuery } from "~/db";
import { displayModelLabel } from "~/settings/ai/stt/shared";
import { syncLocalSttServer } from "~/settings/queries";
import { useConfigValues } from "~/shared/config";
import {
  getTranscriptionLanguages,
  isLocalSttProviderAvailable,
  isOnDeviceSttModel,
  isSupportedLanguagesBatch,
  modelCoversLanguages,
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
  languages?: string[];
};

const LOCAL_PROVIDERS: Partial<Record<SttModelType, string>> = {
  soniqo: "soniqo",
  appleSpeech: "apple_speech",
  gguf: "gguf",
};

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
  const currentPlatform = platform();
  const currentArch = arch();
  const onDevice = Object.values(LOCAL_PROVIDERS).some((provider) =>
    isLocalSttProviderAvailable(provider, currentPlatform, currentArch),
  );
  const supported = useQuery({
    ...localSttQueries.supportedModels(),
    enabled: onDevice,
  });
  const localModels = onDevice
    ? (supported.data ?? []).flatMap((model) => {
        const provider = LOCAL_PROVIDERS[model.model_type];
        return provider
          ? [
              {
                provider,
                model: model.key,
                label: model.display_name,
                languages: provider === "gguf" ? model.languages : undefined,
              },
            ]
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
      languages: localModels.find(
        (model) =>
          model.provider === conn.provider && model.model === conn.model,
      )?.languages,
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
        candidates.map(async ({ provider, model, languages: covered }) => {
          const batch = getBatchProvider(provider, model);
          const supported = covered
            ? modelCoversLanguages(covered, languages)
            : !!batch &&
              (await isSupportedLanguagesBatch(batch, model, languages));
          return batch && supported ? `${provider}:${model}` : null;
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

// A downloaded model that is not the selected one has no local server yet.
// Starting one replaces the selected model's server, which is restored after.
async function startLocalServerFor({
  provider,
  model,
  baseUrl,
}: RetranscriptionModel) {
  if (
    baseUrl ||
    !isOnDeviceSttModel(provider, model) ||
    getBatchProvider(provider, model) !== "whispercpp"
  ) {
    return null;
  }

  const started = await localSttCommands.startServer(model);
  if (started.status === "error") {
    throw new Error(started.error);
  }
  return started.data;
}

/** Transcribes an entry's kept audio again with `model`, through the batch path dictation uses. */
export function useRetranscribe() {
  const sessionId = useRef(`dictation-history-${crypto.randomUUID()}`).current;
  const runBatch = useRunBatch(sessionId);
  const queryClient = useQueryClient();

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
      const localServerUrl = await startLocalServerFor(model);
      const used = await runBatch(path.data, {
        provider: model.provider,
        model: model.model,
        baseUrl: localServerUrl ?? model.baseUrl,
        apiKey: model.apiKey,
        deferAudioFinalization: true,
        notifyOnCompletion: false,
        numSpeakers: 1,
        handlePersist: (words) => {
          text = wordsToText(words);
        },
      }).finally(async () => {
        if (localServerUrl !== null) {
          await syncLocalSttServer();
          await queryClient.invalidateQueries({ queryKey: ["stt-connection"] });
        }
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
