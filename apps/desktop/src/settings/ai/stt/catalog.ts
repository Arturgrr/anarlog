import { useQueries, useQuery } from "@tanstack/react-query";

import { commands as miscCommands } from "@anlg/plugin-misc";
import type { AIProviderStorage } from "@anlg/store";

import {
  rankModelsForLanguages,
  recommendOnDeviceModel,
} from "./on-device-recommendation";
import {
  isDeprecatedSttModel,
  type ProviderId,
  PROVIDERS,
  sttModelQueries,
} from "./shared";

import { providerRowId, useProviderAvailability } from "~/settings/ai/shared";
import {
  getProviderSetup,
  type ProviderSetup,
} from "~/settings/ai/shared/provider-setup";
import { useAiProvidersState } from "~/settings/providers";
import { useConfigValues } from "~/shared/config";
import {
  getSttModelTranscriptionMode,
  getTranscriptionLanguages,
  isLocalSttProvider,
  isLocalSttProviderAvailable,
} from "~/stt/capabilities";
import {
  asSttCatalogModels,
  type SttCatalogModel,
  type SttModelLicense,
  type SttModelTimestamps,
} from "~/stt/gguf";
import { localSttQueries } from "~/stt/useLocalSttModel";

export type SttMode = "live" | "batch";

export type SttModelEntry = {
  id: string;
  displayName?: string;
  description?: string;
  isDownloaded: boolean;
  isDeprecated: boolean;
  recommended: "device" | "languages" | null;
  sizeBytes?: number | null;
  mode: SttMode;
  languages?: string[];
  license?: SttModelLicense | null;
  timestamps?: SttModelTimestamps | null;
};

export type SttProviderStatus = {
  configured: boolean;
  setup: ProviderSetup;
  models: SttModelEntry[];
  // An on-device engine this platform never runs; it is left out of the list.
  unsupportedPlatform?: boolean;
};

export type SttProviderGroup = "local" | "cloud" | "self_hosted";

const SELF_HOSTED_PROVIDERS: readonly string[] = ["nvidia", "custom"];

export function sttProviderGroup(providerId: string): SttProviderGroup {
  if (isLocalSttProvider(providerId)) return "local";
  if (SELF_HOSTED_PROVIDERS.includes(providerId)) return "self_hosted";
  return "cloud";
}

export function usesFreeformSttModel(providerId: string) {
  return SELF_HOSTED_PROVIDERS.includes(providerId);
}

// Capture requests live transcription unless a model is known to work only
// after recording, so a model without a declared mode streams live.
export function sttModelMode(provider: string, model: string): SttMode {
  return getSttModelTranscriptionMode(provider, model) ?? "live";
}

export function useSttCatalog(): {
  providers: Record<ProviderId, SttProviderStatus>;
  isReady: boolean;
} {
  const availability = useProviderAvailability("stt", PROVIDERS);
  const { providers: configuredProviders, isReady } =
    useAiProvidersState("stt");
  const { local_stt_model_path, ai_language, spoken_languages } =
    useConfigValues([
      "local_stt_model_path",
      "ai_language",
      "spoken_languages",
    ] as const);
  const languages = getTranscriptionLanguages(ai_language, spoken_languages);

  const deviceInfo = useQuery({
    queryKey: ["device-info"],
    queryFn: async () => {
      const result = await miscCommands.getDeviceInfo(null);
      return result.status === "ok" ? result.data : null;
    },
    staleTime: Infinity,
  });

  const supportedModels = useQuery({
    ...localSttQueries.supportedModels(),
    select: (result) =>
      result.status === "ok" ? asSttCatalogModels(result.data) : [],
  });

  const localModels = supportedModels.data ?? [];
  const soniqoModels = localModels.filter((m) => m.model_type === "soniqo");
  // Listed only when the backend reports macOS 26 with Apple Speech available.
  const appleSpeechModels = localModels.filter(
    (m) => m.model_type === "appleSpeech",
  );
  const ggufModels = localModels.filter((m) => m.model_type === "gguf");

  const soniqoDownloaded = useQueries({
    queries: soniqoModels.map((m) => sttModelQueries.isDownloaded(m.key)),
  });
  const appleSpeechDownloaded = useQueries({
    queries: appleSpeechModels.map((m) => sttModelQueries.isDownloaded(m.key)),
  });
  const ggufDownloaded = useQueries({
    queries: ggufModels.map((m) => sttModelQueries.isDownloaded(m.key)),
  });

  const runsOnThisPlatform = (providerId: string) =>
    isLocalSttProviderAvailable(
      providerId,
      deviceInfo.data?.platform ?? "",
      deviceInfo.data?.arch ?? "",
    );
  const unsupportedPlatform = (providerId: string) =>
    !!deviceInfo.data && !runsOnThisPlatform(providerId);

  const localStatus = (
    providerId: string,
    models: SttModelEntry[],
  ): SttProviderStatus => ({
    configured: models.length > 0,
    setup: !supportedModels.isFetched
      ? { kind: "checking" }
      : models.length > 0
        ? { kind: "ready" }
        : { kind: "unavailable" },
    models,
    unsupportedPlatform: unsupportedPlatform(providerId),
  });

  const providers = Object.fromEntries(
    PROVIDERS.map((provider): [ProviderId, SttProviderStatus] => {
      if (provider.id === "soniqo") {
        return [
          provider.id,
          localStatus(
            provider.id,
            buildOnDeviceModelEntries(
              soniqoModels,
              soniqoDownloaded,
              deviceInfo.data?.totalMemoryBytes,
            ),
          ),
        ];
      }

      if (provider.id === "apple_speech") {
        return [
          provider.id,
          localStatus(
            provider.id,
            buildOnDeviceModelEntries(
              appleSpeechModels,
              appleSpeechDownloaded,
              deviceInfo.data?.totalMemoryBytes,
            ),
          ),
        ];
      }

      if (provider.id === "gguf") {
        return [
          provider.id,
          localStatus(
            provider.id,
            buildLanguageRankedModelEntries(
              ggufModels,
              ggufDownloaded,
              languages,
            ),
          ),
        ];
      }

      if (provider.id === "local_file") {
        const available = runsOnThisPlatform(provider.id);
        return [
          provider.id,
          {
            configured: available,
            setup: !deviceInfo.isFetched
              ? { kind: "checking" }
              : available
                ? { kind: "ready" }
                : { kind: "unavailable" },
            models: [
              {
                id: "local-file",
                isDownloaded: !!local_stt_model_path?.trim(),
                isDeprecated: false,
                recommended: null,
                mode: "batch",
              },
            ],
            unsupportedPlatform: unsupportedPlatform(provider.id),
          },
        ];
      }

      const setup = getProviderSetup({
        provider,
        config: configuredProviders[providerRowId("stt", provider.id)] as
          | AIProviderStorage
          | undefined,
        availability: availability[provider.id],
      });
      const configured = setup.kind === "ready";

      return [
        provider.id,
        {
          configured,
          setup,
          models: usesFreeformSttModel(provider.id)
            ? []
            : provider.models.map((model) => ({
                id: model,
                isDownloaded: true,
                isDeprecated: isDeprecatedSttModel(provider.id, model),
                recommended: null,
                mode: sttModelMode(provider.id, model),
              })),
        },
      ];
    }),
  ) as Record<ProviderId, SttProviderStatus>;

  return {
    providers,
    isReady:
      isReady &&
      supportedModels.isFetched &&
      deviceInfo.isFetched &&
      Object.values(availability).every((value) => value !== undefined),
  };
}

function buildOnDeviceModelEntries(
  models: SttCatalogModel[],
  downloads: Array<{ data?: boolean }>,
  totalMemoryBytes?: number,
): SttModelEntry[] {
  const recommendedModel = recommendOnDeviceModel(
    models.map((model) => ({
      id: model.key,
      recommendedMemoryBytes: model.recommended_memory_bytes,
    })),
    totalMemoryBytes,
  );

  return models
    .map((model, index) => ({
      id: model.key,
      isDownloaded: downloads[index]?.data ?? false,
      displayName: model.display_name,
      description: model.description || undefined,
      sizeBytes: model.size_bytes,
      isDeprecated: false,
      recommended: model.key === recommendedModel ? ("device" as const) : null,
      mode: model.supports_realtime ? ("live" as const) : ("batch" as const),
    }))
    .sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended));
}

function buildLanguageRankedModelEntries(
  models: SttCatalogModel[],
  downloads: Array<{ data?: boolean }>,
  languages: readonly string[],
): SttModelEntry[] {
  const { order, recommended } = rankModelsForLanguages(
    models.map((model) => ({
      id: model.key,
      languages: model.languages ?? [],
    })),
    languages,
  );

  return models
    .map((model, index) => ({
      id: model.key,
      isDownloaded: downloads[index]?.data ?? false,
      displayName: model.display_name,
      description: model.description || undefined,
      sizeBytes: model.size_bytes,
      isDeprecated: false,
      recommended: model.key === recommended ? ("languages" as const) : null,
      mode: model.supports_realtime ? ("live" as const) : ("batch" as const),
      languages: model.languages ?? [],
      license: model.license,
      timestamps: model.timestamps,
    }))
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}
