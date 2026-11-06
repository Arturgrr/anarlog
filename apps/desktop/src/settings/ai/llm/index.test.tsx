import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  providerFetch: vi.fn(),
  config: {
    current_llm_provider: "openai",
    current_llm_model: "gpt-5.5",
    current_llm_reasoning_effort: "default",
  } as Record<string, unknown>,
}));

vi.mock("~/ai/provider-fetch", () => ({ providerFetch: mocks.providerFetch }));

vi.mock("~/settings/providers", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  const providers = {
    "llm:openai": {
      type: "llm",
      base_url: "https://api.openai.com/v1",
      api_key: "sk-saved",
    },
  };
  return {
    useAiProvidersState: () => ({ providers, isReady: true, isLoading: false }),
    useAiProviders: () => providers,
    useSetAiProvider: () => useMutation({ mutationFn: async () => {} }),
    useClearAiProvider: () => useMutation({ mutationFn: async () => {} }),
    isKeychainAccessError: () => false,
    repairKeychainAccess: vi.fn(),
  };
});

vi.mock("~/settings/ai/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/settings/ai/shared")>()),
  useProviderAvailability: () => ({ openai: true }),
}));

vi.mock("~/shared/config", () => ({
  useConfigValue: (key: string) => mocks.config[key],
  useConfigValues: (keys: readonly string[]) =>
    Object.fromEntries(keys.map((key) => [key, mocks.config[key]])),
}));

vi.mock("~/settings/queries", () => ({
  setSettingValues: vi.fn().mockResolvedValue(undefined),
  useSetSettingValue: () => vi.fn(),
  useSettingsReady: () => true,
}));

vi.mock("./health", () => ({
  useConnectionHealth: () => ({ status: null }),
}));

import { LlmModelPicker } from "./index";

afterEach(cleanup);

test("shows why the model list failed to load instead of an empty list", async () => {
  mocks.providerFetch.mockResolvedValue(
    new Response(
      JSON.stringify({ error: { message: "Incorrect API key provided" } }),
      { status: 401 },
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <LlmModelPicker variant="page" />
    </QueryClientProvider>,
  );

  expect((await screen.findByRole("alert")).textContent).toContain(
    "Couldn’t load the model list: HTTP 401 · Incorrect API key provided",
  );
});
