import { useLingui } from "@lingui/react/macro";
import { useQueries, useQuery } from "@tanstack/react-query";

import type { LocalModel } from "@anlg/plugin-local-stt";

import { useNotifications } from "~/contexts/notifications";
import { useConnectionHealth as useLlmConnectionHealth } from "~/settings/ai/llm/health";
import { PROVIDERS as LLM_PROVIDERS } from "~/settings/ai/llm/shared";
import { providerRowId, useProviderAvailability } from "~/settings/ai/shared";
import { displayLlmModelId } from "~/settings/ai/shared/model-display";
import { providerDisplayName } from "~/settings/ai/shared/provider-labels";
import {
  getProviderSetup,
  type ProviderSetup,
} from "~/settings/ai/shared/provider-setup";
import { useSttSettings } from "~/settings/ai/stt/context";
import { useConnectionHealth as useSttConnectionHealth } from "~/settings/ai/stt/health";
import {
  displayModelLabel,
  PROVIDERS as STT_PROVIDERS,
} from "~/settings/ai/stt/shared";
import { useAiProviders } from "~/settings/providers";
import { useConfigValues } from "~/shared/config";
import { usePendingLlmSelection } from "~/store/zustand/pending-llm-selection";
import { usePendingSttSelection } from "~/store/zustand/pending-stt-selection";
import { isConfiguredSttModel, isOnDeviceSttModel } from "~/stt/capabilities";
import { localSttQueries } from "~/stt/useLocalSttModel";

export type ModelSetupStatus =
  | { kind: "none" }
  | {
      kind: "installing";
      model: string;
      provider: string;
      progress: number | null;
    }
  | {
      kind: "checking" | "error";
      model: string;
      provider: string;
      message: string;
    }
  | { kind: "ready"; model: string; provider: string };

export type ModelInstall = {
  id: string;
  name: string;
  provider: string;
  sizeBytes: number | null;
  state: InstallState;
  start: () => void;
};

type InstallState =
  | { kind: "checking" | "queued" | "interrupted" }
  | { kind: "downloading" | "preparing"; progress: number }
  | { kind: "error"; message: string };

// The last percent covers unpacking and loading the model, which reports no
// progress of its own.
const PREPARING_FROM_PERCENT = 99;

type ProviderHealth = {
  status: "pending" | "error" | "success" | null;
  message?: string;
};

export function useTranscriptionSetup(): ModelSetupStatus {
  const { i18n } = useLingui();
  const { current_stt_provider, current_stt_model } = useConfigValues([
    "current_stt_provider",
    "current_stt_model",
  ] as const);
  const pending = usePendingSttSelection((state) => state.selection);
  const { activeDownloads } = useNotifications();
  const health = useSttConnectionHealth();
  const provider = STT_PROVIDERS.find(({ id }) => id === current_stt_provider);
  const setup = useCurrentProviderSetup("stt", provider);
  const describe = useDescribeSetup();

  // A download the user started replaces the current model once it finishes,
  // so it is the choice to report even while an older model is still current.
  const download = pending
    ? activeDownloads.find(({ model }) => model === pending.model)
    : undefined;
  if (pending && download) {
    const pendingProvider = STT_PROVIDERS.find(
      ({ id }) => id === pending.provider,
    );
    return {
      kind: "installing",
      model: displayModelLabel(pending.model),
      provider: pendingProvider
        ? providerDisplayName(pendingProvider, i18n)
        : pending.provider,
      progress: download.isStarting ? null : download.progress,
    };
  }

  if (
    !provider ||
    !setup ||
    !current_stt_model ||
    !isConfiguredSttModel(current_stt_provider, current_stt_model)
  ) {
    return { kind: "none" };
  }

  return describe(
    {
      model: displayModelLabel(current_stt_model),
      provider: providerDisplayName(provider, i18n),
    },
    setup,
    health,
  );
}

export function useIntelligenceSetup(): ModelSetupStatus {
  const { i18n } = useLingui();
  const { current_llm_provider, current_llm_model } = useConfigValues([
    "current_llm_provider",
    "current_llm_model",
  ] as const);
  const health = useLlmConnectionHealth();
  const provider = LLM_PROVIDERS.find(({ id }) => id === current_llm_provider);
  const setup = useCurrentProviderSetup("llm", provider);
  const describe = useDescribeSetup();
  const pendingBuiltin = usePendingLlmSelection((state) => state.model);
  const { activeDownloads } = useNotifications();

  // A built-in model being downloaded becomes the choice when it finishes.
  if (pendingBuiltin) {
    const download = activeDownloads.find(
      ({ model }) => model === pendingBuiltin,
    );
    const builtin = LLM_PROVIDERS.find(({ id }) => id === "builtin");
    return {
      kind: "installing",
      model: displayLlmModelId(pendingBuiltin),
      provider: builtin ? providerDisplayName(builtin, i18n) : "builtin",
      progress: download && !download.isStarting ? download.progress : null,
    };
  }

  if (!provider || !setup || !current_llm_model) {
    return { kind: "none" };
  }

  return describe(
    {
      model: displayLlmModelId(current_llm_model),
      provider: providerDisplayName(provider, i18n),
    },
    setup,
    health,
  );
}

function useCurrentProviderSetup<
  T extends Parameters<typeof useProviderAvailability>[1][number],
>(type: "stt" | "llm", provider: T | undefined): ProviderSetup | null {
  const configs = useAiProviders(type);
  const availability = useProviderAvailability(
    type,
    provider ? [provider] : [],
  );

  return provider
    ? getProviderSetup({
        provider,
        config: configs[providerRowId(type, provider.id)],
        availability: availability[provider.id],
      })
    : null;
}

function useDescribeSetup() {
  const { t } = useLingui();

  return (
    labels: { model: string; provider: string },
    setup: ProviderSetup,
    health: ProviderHealth,
  ): ModelSetupStatus => {
    switch (setup.kind) {
      case "checking":
        return {
          kind: "checking",
          ...labels,
          message: t`Checking the connection…`,
        };
      case "rejected":
        return {
          kind: "error",
          ...labels,
          message: t`The key was rejected. Check it above.`,
        };
      case "missing":
        return {
          kind: "error",
          ...labels,
          message: t`Finish the connection above to use these models.`,
        };
      case "stopped":
        return { kind: "error", ...labels, message: t`Server stopped` };
      case "unavailable":
        return {
          kind: "error",
          ...labels,
          message: t`Not available on this computer.`,
        };
    }

    if (health.status === "pending") {
      return {
        kind: "checking",
        ...labels,
        message: health.message ?? t`Checking the connection…`,
      };
    }
    if (health.status === "error") {
      return {
        kind: "error",
        ...labels,
        message: health.message ?? t`Unknown error`,
      };
    }
    return { kind: "ready", ...labels };
  };
}

// Selected local models that still have to be installed before onboarding can
// finish. Only on-device transcription is downloaded by Librelog today; cloud
// providers and models built into macOS never appear here.
export function useModelInstalls(): ModelInstall[] {
  const { i18n } = useLingui();
  const { current_stt_provider, current_stt_model } = useConfigValues([
    "current_stt_provider",
    "current_stt_model",
  ] as const);
  const pending = usePendingSttSelection((state) => state.selection);
  const failures = usePendingSttSelection((state) => state.failedDownloads);
  const { activeDownloads } = useNotifications();
  const { startDownload } = useSttSettings();
  const supportedModels = useQuery(localSttQueries.supportedModels());

  const selections: Array<{ provider: string; model: LocalModel }> = pending
    ? [pending]
    : isOnDeviceSttModel(current_stt_provider, current_stt_model)
      ? [{ provider: current_stt_provider ?? "", model: current_stt_model }]
      : [];
  const downloaded = useQueries({
    queries: selections.map(({ model }) => localSttQueries.isDownloaded(model)),
  });
  const downloading = useQueries({
    queries: selections.map(({ model }) =>
      localSttQueries.isDownloading(model),
    ),
  });

  return selections.flatMap(({ provider, model }, index) => {
    const state = getInstallState({
      download: activeDownloads.find((entry) => entry.model === model),
      downloaded: downloaded[index],
      downloading: downloading[index]?.data,
      failure: failures[model],
    });
    if (!state) {
      return [];
    }

    const info = supportedModels.data?.find(({ key }) => key === model);
    const providerInfo = STT_PROVIDERS.find(({ id }) => id === provider);
    return [
      {
        id: model,
        name: displayModelLabel(model, info?.display_name),
        provider: providerInfo
          ? providerDisplayName(providerInfo, i18n)
          : provider,
        sizeBytes: info?.size_bytes ?? null,
        state,
        start: () => startDownload(model, provider),
      },
    ];
  });
}

function getInstallState({
  download,
  downloaded,
  downloading,
  failure,
}: {
  download: { progress: number; isStarting?: boolean } | undefined;
  downloaded: { data?: boolean; isError: boolean } | undefined;
  downloading: boolean | undefined;
  failure: string | undefined;
}): InstallState | null {
  if (download) {
    if (download.isStarting) {
      return { kind: "queued" };
    }
    return {
      kind:
        download.progress >= PREPARING_FROM_PERCENT
          ? "preparing"
          : "downloading",
      progress: download.progress,
    };
  }
  if (downloaded?.data === undefined && !downloaded?.isError) {
    return { kind: "checking" };
  }
  if (downloaded.data) {
    return null;
  }
  if (failure) {
    return { kind: "error", message: failure };
  }
  return downloading ? { kind: "queued" } : { kind: "interrupted" };
}
