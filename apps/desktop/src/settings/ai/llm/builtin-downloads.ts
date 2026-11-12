import { t } from "@lingui/core/macro";
import type { QueryClient } from "@tanstack/react-query";

import {
  commands,
  type LlmDownloadProgress,
  type LlmModel,
} from "@anlg/plugin-local-llm";
import { toast } from "@anlg/ui/components/ui/toast";

import { asLlmError, builtinErrorMessage } from "~/ai/builtin-fetch";
import { builtinQueries } from "~/settings/ai/shared/list-builtin";
import { displayLlmModelId } from "~/settings/ai/shared/model-display";
import { setSettingValues } from "~/settings/queries";
import { usePendingLlmSelection } from "~/store/zustand/pending-llm-selection";

export const BUILTIN_PROVIDER_ID = "builtin";

// Starts a download and makes the model the Intelligence model once it is
// in place, as choosing an on-device transcription model does.
export async function startBuiltinDownload(model: LlmModel) {
  usePendingLlmSelection.setState(({ failedDownloads }) => {
    const { [model]: _, ...rest } = failedDownloads;
    return { model, failedDownloads: rest };
  });
  const result = await commands.downloadModel(model);
  if (result.status === "error") {
    const message = builtinErrorMessage(asLlmError(result.error));
    usePendingLlmSelection.setState((state) => ({
      model: state.model === model ? null : state.model,
      failedDownloads: { ...state.failedDownloads, [model]: message },
    }));
    throw new Error(message);
  }
}

export function handleBuiltinDownloadEvent(
  queryClient: QueryClient,
  { model, status }: LlmDownloadProgress,
) {
  const name = displayLlmModelId(model);
  const pending = usePendingLlmSelection.getState().model === model;

  if (status === "completed") {
    void queryClient.invalidateQueries({ queryKey: ["builtin-llm"] });
    void queryClient.invalidateQueries({
      queryKey: ["models", BUILTIN_PROVIDER_ID],
    });
    toast.success(t`Model downloaded`, { description: name });
    if (pending) {
      void setSettingValues({
        current_llm_provider: BUILTIN_PROVIDER_ID,
        current_llm_model: model,
        current_llm_reasoning_effort: "default",
      })
        .catch((error) => {
          console.error("[settings] failed to select downloaded model", error);
        })
        .finally(() => {
          if (usePendingLlmSelection.getState().model === model) {
            usePendingLlmSelection.setState({ model: null });
          }
        });
    }
    return;
  }

  if (typeof status === "object" && "failed" in status) {
    void queryClient.invalidateQueries({
      queryKey: builtinQueries.models().queryKey,
    });
    usePendingLlmSelection.setState((state) => ({
      model: state.model === model ? null : state.model,
      failedDownloads: { ...state.failedDownloads, [model]: status.failed },
    }));
    toast.error(t`Couldn’t download ${name}`, { description: status.failed });
  }
}
