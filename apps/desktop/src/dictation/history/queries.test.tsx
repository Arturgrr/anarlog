import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

const DOWNLOADED = new Set(["gguf-parakeet-tdt-0.6b-v3", "gguf-gigaam-v3"]);
// What the transcription plugin answers from the catalog, asked with the
// models' batch provider.
const SPEAKS: Record<string, string[]> = {
  "gguf-parakeet-tdt-0.6b-v3": ["en", "pt", "de"],
  "gguf-gigaam-v3": ["ru"],
};

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => "linux",
  arch: () => "x86_64",
}));

vi.mock("@anlg/plugin-local-stt", () => ({
  commands: {
    listSupportedModels: async () => ({
      status: "ok",
      data: [
        "gguf-parakeet-tdt-0.6b-v3",
        "gguf-whisper-large-v3-turbo",
        "gguf-gigaam-v3",
      ].map((key) => ({
        key,
        display_name: key,
        description: "",
        size_bytes: 1,
        model_type: "gguf",
        supports_realtime: false,
        recommended_memory_bytes: 1,
      })),
    }),
    isModelDownloaded: async (model: string) => ({
      status: "ok",
      data: DOWNLOADED.has(model),
    }),
  },
}));

vi.mock("~/stt/capabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/stt/capabilities")>()),
  isSupportedLanguagesBatch: async (
    provider: string,
    model: string,
    languages: readonly string[],
  ) =>
    provider === "whispercpp" &&
    languages.every((language) => SPEAKS[model]?.includes(language)),
}));

vi.mock("~/stt/useSTTConnection", () => ({
  useSTTConnection: () => ({ conn: null }),
}));

vi.mock("~/shared/config", () => ({
  useConfigValues: () => ({ ai_language: "pt", spoken_languages: [] }),
}));

vi.mock("~/settings/queries", () => ({
  syncLocalSttServer: vi.fn(),
}));

vi.mock("~/stt/useRunBatch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/stt/useRunBatch")>()),
  useRunBatch: vi.fn(),
}));

import { useRetranscriptionModels } from "./queries";

afterEach(cleanup);

test("offers downloaded GGUF models that speak the dictation language for re-transcription on Linux", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(useRetranscriptionModels, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });

  await waitFor(() => expect(result.current.models).not.toHaveLength(0));
  expect(
    result.current.models.map(({ provider, model }) => `${provider}:${model}`),
  ).toEqual(["gguf:gguf-parakeet-tdt-0.6b-v3"]);
});
