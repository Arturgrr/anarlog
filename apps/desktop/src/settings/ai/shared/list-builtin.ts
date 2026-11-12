import { queryOptions, useQuery } from "@tanstack/react-query";

import { commands } from "@anlg/plugin-local-llm";

import type { ListModelsResult } from "./list-common";

import { asLlmError, builtinErrorMessage } from "~/ai/builtin-fetch";

export const builtinQueries = {
  runtime: () =>
    queryOptions({
      queryKey: ["builtin-llm", "runtime"],
      queryFn: builtinRuntimeStatus,
      staleTime: Infinity,
    }),
  models: () =>
    queryOptions({
      queryKey: ["builtin-llm", "models"],
      queryFn: async () => {
        const result = await commands.listModels();
        if (result.status === "error") {
          throw new Error(builtinErrorMessage(asLlmError(result.error)));
        }
        return result.data;
      },
    }),
  server: () =>
    queryOptions({
      queryKey: ["builtin-llm", "server"],
      queryFn: async () => {
        const result = await commands.serverState();
        return result.status === "ok"
          ? result.data
          : ({ status: "stopped" } as const);
      },
    }),
};

// The App Store build does not register the plugin at all.
async function builtinRuntimeStatus() {
  try {
    const result = await commands.runtimeStatus();
    if (result.status === "ok") {
      return result.data;
    }
  } catch {}
  return {
    available: false,
    reason: "unsupported_platform" as const,
    totalMemoryBytes: 0,
  };
}

// Windows, Linux and the App Store build can never run built-in models, so
// they do not list them. A Mac build without the server, such as a dev
// build, lists them with the reason.
export function useBuiltinProviderListed(): boolean {
  const runtime = useQuery(builtinQueries.runtime());
  return (
    runtime.data?.available === true ||
    runtime.data?.reason === "missing_binary"
  );
}

export async function checkBuiltinAvailability(): Promise<boolean> {
  return (await builtinRuntimeStatus()).available;
}

// Only downloaded models can be chosen; Settings lists the whole catalog
// with download buttons.
export async function listBuiltinModels(): Promise<ListModelsResult> {
  const result = await commands.listModels();
  if (result.status === "error") {
    throw new Error(builtinErrorMessage(asLlmError(result.error)));
  }
  const models = result.data
    .filter(
      ({ downloaded, admission }) => downloaded && admission.fit !== "tooLarge",
    )
    .map(({ id }) => id);
  return {
    models,
    ignored: [],
    metadata: Object.fromEntries(
      models.map((id) => [id, { input_modalities: ["text"] as const }]),
    ),
  };
}
