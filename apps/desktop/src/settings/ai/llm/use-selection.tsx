import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { modelListQueryKey } from "./model-lists";
import {
  getDefaultLlmSelection,
  isSameModelSelection,
  shouldShowMissingModelWarning,
} from "./selection";
import { PROVIDERS } from "./shared";
import type { LlmProviderStatus, useLlmProviderStatuses } from "./status";

import { PersistAiSelection } from "~/settings/ai/shared/persist-selection";
import {
  getConfiguredProviderIds,
  getVisibleModelSelection,
} from "~/settings/ai/shared/selection";
import { setSettingValues, useSettingsReady } from "~/settings/queries";
import { useConfigValues } from "~/shared/config";

type PendingSelection = {
  provider: string;
  model: string;
  originProvider: string | undefined;
  originModel: string | undefined;
};

export function useLlmSelection(
  statuses: ReturnType<typeof useLlmProviderStatuses>,
) {
  const { current_llm_model, current_llm_provider, intelligence_disabled } =
    useConfigValues([
      "current_llm_model",
      "current_llm_provider",
      "intelligence_disabled",
    ] as const);
  const settingsReady = useSettingsReady() && !intelligence_disabled;
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelection | null>(null);
  const lastUsedModelsRef = useRef<Record<string, string>>(
    current_llm_provider && current_llm_model
      ? { [current_llm_provider]: current_llm_model }
      : {},
  );
  const selectionRequestRef = useRef(0);

  const visibleSelection = getVisibleModelSelection(
    current_llm_provider,
    current_llm_model,
    current_llm_provider
      ? (statuses.providers[current_llm_provider]?.configured ?? false)
      : false,
  );
  const configuredProviderIds = getConfiguredProviderIds(
    PROVIDERS,
    statuses.providers,
    current_llm_provider,
  );
  const pendingSelectionSettled =
    pendingSelection &&
    isSameModelSelection(
      current_llm_provider,
      current_llm_model,
      pendingSelection.provider,
      pendingSelection.model,
    );
  if (pendingSelectionSettled) {
    setPendingSelection(null);
  }
  const activePendingSelection =
    pendingSelection &&
    !pendingSelectionSettled &&
    isSameModelSelection(
      current_llm_provider,
      current_llm_model,
      pendingSelection.originProvider,
      pendingSelection.originModel,
    )
      ? pendingSelection
      : null;

  const needsDefaultSelection = !(
    visibleSelection.provider && visibleSelection.model
  );
  const preferredModel =
    current_llm_model ||
    (current_llm_provider
      ? lastUsedModelsRef.current[current_llm_provider]
      : undefined);
  const providerStatuses = statuses.providers;
  const defaultSelectionQuery = useQuery({
    queryKey: [
      "default-ai-selection",
      "llm",
      current_llm_provider ?? "",
      preferredModel ?? "",
      configuredProviderIds,
      providerStatuses,
    ],
    queryFn: async ({ client }) =>
      await getDefaultLlmSelection(
        configuredProviderIds,
        current_llm_provider,
        preferredModel,
        (provider) => fetchProviderModels(client, provider, providerStatuses),
      ),
    enabled:
      !activePendingSelection &&
      statuses.isReady &&
      needsDefaultSelection &&
      configuredProviderIds.length > 0,
    retry: false,
    staleTime: Infinity,
  });
  const defaultSelection = needsDefaultSelection
    ? defaultSelectionQuery.data
    : null;
  const effectiveSelection = activePendingSelection
    ? {
        provider: activePendingSelection.provider,
        model: activePendingSelection.model,
      }
    : (defaultSelection ?? visibleSelection);
  const isConfigured = !!(
    effectiveSelection.provider && effectiveSelection.model
  );

  const select = (provider: string, model: string) => {
    const requestId = ++selectionRequestRef.current;
    lastUsedModelsRef.current[provider] = model;
    setPendingSelection({
      provider,
      model,
      originProvider: current_llm_provider,
      originModel: current_llm_model,
    });
    // Effort support differs per model, so a stale level would break
    // requests against a model that rejects the parameter.
    void setSettingValues({
      current_llm_provider: provider,
      current_llm_model: model,
      current_llm_reasoning_effort: "default",
    }).catch((error) => {
      console.error("[settings] failed to update LLM selection", error);
      if (selectionRequestRef.current === requestId) {
        setPendingSelection(null);
      }
    });
  };

  return {
    current: isConfigured ? effectiveSelection : null,
    isPending: !!activePendingSelection,
    select,
    showMissingModelWarning: shouldShowMissingModelWarning({
      isConfigured,
      isResolvingSelection: defaultSelectionQuery.isFetching,
      providerSettingsReady: statuses.isReady,
      settingsReady,
    }),
    persistDefault:
      defaultSelection && !activePendingSelection ? (
        <PersistAiSelection
          key={`llm:${defaultSelection.provider}:${defaultSelection.model}`}
          type="llm"
          provider={defaultSelection.provider}
          model={defaultSelection.model}
        />
      ) : null,
  };
}

async function fetchProviderModels(
  client: QueryClient,
  provider: string,
  statuses: Record<string, LlmProviderStatus>,
) {
  const status = statuses[provider];
  if (!status?.listModels) {
    return [];
  }

  // eslint-disable-next-line @tanstack/query/exhaustive-deps -- listModelsKey hashes the provider, endpoint and key the listModels closure was built from.
  const result = await client.fetchQuery({
    queryKey: modelListQueryKey(provider, status.listModelsKey),
    queryFn: () => status.listModels!(),
    retry: 3,
    retryDelay: 300,
    staleTime: 1000 * 2,
  });

  return result.models;
}
