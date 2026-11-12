import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import type { GgufModel, SttModelInfo } from "@anlg/plugin-local-stt";

const { useProviderAvailabilityMock, config } = vi.hoisted(() => ({
  useProviderAvailabilityMock: vi.fn(),
  config: { local_stt_model_path: "" } as Record<string, unknown>,
}));

vi.mock("~/settings/ai/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/settings/ai/shared")>()),
  useProviderAvailability: useProviderAvailabilityMock,
}));

vi.mock("~/settings/providers", () => ({
  useAiProvidersState: () => ({
    isReady: true,
    providers: { "stt:deepgram": { api_key: "saved-key" } },
  }),
}));

vi.mock("~/shared/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/shared/config")>()),
  useConfigValues: () => config,
}));

import { useSttCatalog } from "./catalog";

import { localSttQueries } from "~/stt/useLocalSttModel";

afterEach(cleanup);

function renderCatalog(client: QueryClient) {
  return renderHook(useSttCatalog, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

test.each([true, false])(
  "waits for saved transcription credentials before enabling selection repair (%s)",
  (verified) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["device-info"], { totalMemoryBytes: 16e9 });
    client.setQueryData(localSttQueries.supportedModels().queryKey, {
      status: "ok",
      data: [],
    });
    useProviderAvailabilityMock.mockReturnValue({ deepgram: undefined });

    const { result, rerender } = renderCatalog(client);

    expect(result.current.providers.deepgram.configured).toBe(false);
    expect(result.current.isReady).toBe(false);

    useProviderAvailabilityMock.mockReturnValue({ deepgram: verified });
    rerender();

    expect(result.current.isReady).toBe(true);
    expect(result.current.providers.deepgram.configured).toBe(verified);
  },
);

test("lists only the GGUF models the engine reports and hides Mac-only engines on Linux", () => {
  const gguf = (key: GgufModel, languages: string[]): SttModelInfo => ({
    key,
    display_name: key,
    description: "",
    size_bytes: 740e6,
    model_type: "gguf",
    supports_realtime: false,
    recommended_memory_bytes: 4e9,
    languages,
    license: {
      spdx: "CC-BY-4.0",
      name: "CC BY 4.0",
      url: "https://creativecommons.org/licenses/by/4.0/",
      attribution: null,
    },
    source_url: `https://huggingface.co/example/${key}`,
    timestamps: "word",
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["device-info"], {
    platform: "linux",
    arch: "x86_64",
    totalMemoryBytes: 16e9,
  });
  // This build withholds Parakeet Unified English.
  client.setQueryData(localSttQueries.supportedModels().queryKey, {
    status: "ok",
    data: [
      gguf("gguf-whisper-large-v3-turbo", ["*"]),
      gguf("gguf-gigaam-v3", ["ru"]),
      gguf("gguf-parakeet-tdt-0.6b-v3", ["en", "pt", "de"]),
    ],
  });
  useProviderAvailabilityMock.mockReturnValue({});
  config.ai_language = "en";
  config.spoken_languages = [];

  const { result } = renderCatalog(client);
  const { gguf: ggufStatus, soniqo, local_file } = result.current.providers;

  // English's first pick is the withheld model, so the next one leads.
  expect(ggufStatus.models.map(({ id }) => id)).toEqual([
    "gguf-whisper-large-v3-turbo",
    "gguf-parakeet-tdt-0.6b-v3",
    "gguf-gigaam-v3",
  ]);
  expect(ggufStatus.models[0]).toMatchObject({
    recommended: "languages",
    mode: "batch",
    license: { name: "CC BY 4.0" },
    timestamps: "word",
  });
  expect(soniqo.unsupportedPlatform).toBe(true);
  expect(local_file.unsupportedPlatform).toBe(false);
  expect(local_file.configured).toBe(true);
});
