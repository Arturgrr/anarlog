import { useLingui } from "@lingui/react/macro";

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
import { useConnectionHealth as useSttConnectionHealth } from "~/settings/ai/stt/health";
import {
  displayModelLabel,
  PROVIDERS as STT_PROVIDERS,
} from "~/settings/ai/stt/shared";
import { useAiProviders } from "~/settings/providers";
import { useConfigValues } from "~/shared/config";
import { usePendingSttSelection } from "~/store/zustand/pending-stt-selection";
import { isConfiguredSttModel } from "~/stt/capabilities";

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
          message: t`Not available on this Mac.`,
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
