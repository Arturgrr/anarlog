import { useQueries } from "@tanstack/react-query";

import { PROVIDERS } from "./shared";
import type { LlmProviderStatus } from "./status";

import type {
  ListModelsResult,
  ModelMetadata,
} from "~/settings/ai/shared/list-common";
import { modelSupportsImageInput } from "~/settings/ai/shared/model-capabilities";

export type LlmModelList = {
  result?: ListModelsResult;
  error?: string;
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => void;
};

export function modelListQueryKey(providerId: string, listModelsKey?: string) {
  return ["models", providerId, listModelsKey ?? ""] as const;
}

export function useLlmModelLists(
  statuses: Record<string, LlmProviderStatus>,
): Record<string, LlmModelList> {
  const providerIds = PROVIDERS.map(({ id }) => id).filter(
    (id) => !!statuses[id]?.listModels,
  );

  return useQueries({
    queries: providerIds.map((id) => {
      const status = statuses[id]!;
      return {
        queryKey: modelListQueryKey(id, status.listModelsKey),
        queryFn: () => status.listModels!(),
        retry: 3,
        retryDelay: 300,
        staleTime: 30_000,
      };
    }),
    combine: (results) =>
      Object.fromEntries(
        results.map((result, index) => [
          providerIds[index]!,
          {
            result: result.data,
            error: result.error?.message ?? result.data?.error,
            isLoading: result.isPending,
            isFetching: result.isFetching,
            refetch: () => void result.refetch(),
          },
        ]),
      ),
  });
}

// Real per-model modality data wins; providers that report none fall back to
// the same id heuristic Librelog uses when deciding whether to send images.
export function llmModelReadsImages(
  providerId: string,
  modelId: string,
  metadata: ModelMetadata | undefined,
) {
  return metadata?.input_modalities
    ? metadata.input_modalities.includes("image")
    : modelSupportsImageInput(providerId, modelId);
}
