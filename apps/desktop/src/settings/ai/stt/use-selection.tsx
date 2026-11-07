import { useRef } from "react";

import type { useSttCatalog } from "./catalog";
import { getDefaultSttSelection } from "./selection";
import { type ProviderId, PROVIDERS } from "./shared";

import { PersistAiSelection } from "~/settings/ai/shared/persist-selection";
import {
  getConfiguredProviderIds,
  getVisibleModelSelection,
} from "~/settings/ai/shared/selection";
import { useSetSettingValues } from "~/settings/queries";
import { useConfigValues } from "~/shared/config";
import { usePendingSttSelection } from "~/store/zustand/pending-stt-selection";
import { isConfiguredSttModel } from "~/stt/capabilities";
import { getDefaultSttModel } from "~/stt/model-selection";

export function useSttSelection(catalog: ReturnType<typeof useSttCatalog>) {
  const { current_stt_provider, current_stt_model } = useConfigValues([
    "current_stt_provider",
    "current_stt_model",
  ] as const);
  const pendingSelection = usePendingSttSelection((state) => state.selection);
  const setSelection = useSetSettingValues();

  const selectedSttModel = isConfiguredSttModel(
    current_stt_provider,
    current_stt_model,
  )
    ? current_stt_model
    : undefined;
  const selectedProvider = current_stt_provider as ProviderId | undefined;
  const lastUsedModelsRef = useRef<Record<string, string>>(
    selectedProvider && selectedSttModel
      ? { [selectedProvider]: selectedSttModel }
      : {},
  );
  const visibleSelection = getVisibleModelSelection(
    selectedProvider,
    selectedSttModel,
    selectedProvider
      ? (catalog.providers[selectedProvider]?.configured ?? false)
      : false,
  );
  const defaultSelection =
    catalog.isReady && !visibleSelection.model
      ? getDefaultSttSelection(
          getConfiguredProviderIds(
            PROVIDERS.filter(({ disabled }) => !disabled),
            catalog.providers,
            selectedProvider,
          ),
          catalog.providers,
          selectedProvider,
          current_stt_model ||
            (selectedProvider
              ? lastUsedModelsRef.current[selectedProvider]
              : undefined),
        )
      : null;
  const current = defaultSelection ?? visibleSelection;

  const select = (provider: string, model: string) => {
    lastUsedModelsRef.current[provider] = model;
    usePendingSttSelection.setState({ selection: null });
    setSelection({
      current_stt_provider: provider,
      current_stt_model: model,
    });
  };

  const lastUsedModel = (provider: string) =>
    (current.provider === provider ? current.model : undefined) ||
    lastUsedModelsRef.current[provider] ||
    getDefaultSttModel(provider) ||
    "";

  return {
    current: current.provider && current.model ? current : null,
    pendingSelection,
    select,
    lastUsedModel,
    persistDefault:
      defaultSelection && !pendingSelection ? (
        <PersistAiSelection
          key={`stt:${defaultSelection.provider}:${defaultSelection.model}`}
          type="stt"
          provider={defaultSelection.provider}
          model={defaultSelection.model}
        />
      ) : null,
  };
}
