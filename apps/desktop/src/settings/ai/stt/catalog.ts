import { useQueries, useQuery } from "@tanstack/react-query";

import {
  commands as localSttCommands,
  type LocalModel,
} from "@anlg/plugin-local-stt";
import { commands as miscCommands } from "@anlg/plugin-misc";
import type { AIProviderStorage } from "@anlg/store";

import { recommendOnDeviceModel } from "./on-device-recommendation";
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
  isDesktopLocalSttAvailable,
} from "~/stt/capabilities";

export type SttMode = "live" | "batch";

export type SttModelEntry = {
  id: string;
  displayName?: string;
  description?: string;
  isDownloaded: boolean;
  isDeprecated: boolean;
  isRecommended: boolean;
  sizeBytes?: number | null;
  mode: SttMode;
};

export type SttProviderStatus = {
  configured: boolean;
  setup: ProviderSetup;
  models: SttModelEntry[];
};

export type SttProviderGroup = "local" | "cloud" | "self_hosted";

const LOCAL_PROVIDERS: readonly string[] = [
  "soniqo",
  "apple_speech",
  "local_file",
];
const SELF_HOSTED_PROVIDERS: readonly string[] = ["nvidia", "custom"];

export function sttProviderGroup(providerId: string): SttProviderGroup {
  if (LOCAL_PROVIDERS.includes(providerId)) return "local";
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
  const { local_stt_model_path } = useConfigValues([
    "local_stt_model_path",
  ] as const);

  const deviceInfo = useQuery({
    queryKey: ["device-info"],
    queryFn: async () => {
      const result = await miscCommands.getDeviceInfo(null);
      return result.status === "ok" ? result.data : null;
    },
    staleTime: Infinity,
  });

  const supportedModels = useQuery({
    queryKey: ["list-supported-models"],
    queryFn: async () => {
      const result = await localSttCommands.listSupportedModels();
      return result.status === "ok" ? result.data : [];
    },
    staleTime: Infinity,
  });

  const localModels = supportedModels.data ?? [];
  const soniqoModels = localModels.filter((m) => m.model_type === "soniqo");
  // Listed only when the backend reports macOS 26 with Apple Speech available.
  const appleSpeechModels = localModels.filter(
    (m) => m.model_type === "appleSpeech",
  );

  const soniqoDownloaded = useQueries({
    queries: soniqoModels.map((m) => sttModelQueries.isDownloaded(m.key)),
  });
  const appleSpeechDownloaded = useQueries({
    queries: appleSpeechModels.map((m) => sttModelQueries.isDownloaded(m.key)),
  });

  const localStatus = (models: SttModelEntry[]): SttProviderStatus => ({
    configured: models.length > 0,
    setup: !supportedModels.isFetched
      ? { kind: "checking" }
      : models.length > 0
        ? { kind: "ready" }
        : { kind: "unavailable" },
    models,
  });

  const providers = Object.fromEntries(
    PROVIDERS.map((provider): [ProviderId, SttProviderStatus] => {
      if (provider.id === "soniqo") {
        return [
          provider.id,
          localStatus(
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
            buildOnDeviceModelEntries(
              appleSpeechModels,
              appleSpeechDownloaded,
              deviceInfo.data?.totalMemoryBytes,
            ),
          ),
        ];
      }

      if (provider.id === "local_file") {
        const available = isDesktopLocalSttAvailable(
          deviceInfo.data?.platform ?? "",
          deviceInfo.data?.arch ?? "",
        );
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
                isRecommended: false,
                mode: "batch",
              },
            ],
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
                isRecommended: false,
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
  models: Array<{
    key: LocalModel;
    display_name: string;
    description: string;
    size_bytes: number | null;
    supports_realtime: boolean;
    recommended_memory_bytes: number;
  }>,
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
      isRecommended: model.key === recommendedModel,
      mode: model.supports_realtime ? ("live" as const) : ("batch" as const),
    }))
    .sort((a, b) => Number(b.isRecommended) - Number(a.isRecommended));
}
