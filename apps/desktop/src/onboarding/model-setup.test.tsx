import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

type Health = {
  status: "pending" | "error" | "success" | null;
  message?: string;
};

const mocks = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  providers: { stt: {}, llm: {} } as Record<string, Record<string, unknown>>,
  availability: { stt: {}, llm: {} } as Record<
    string,
    Record<string, boolean | undefined>
  >,
  activeDownloads: [] as Array<{
    model: string;
    displayName: string;
    progress: number;
  }>,
  sttHealth: { status: null } as Health,
  llmHealth: { status: null } as Health,
}));

vi.mock("~/settings/ai/stt", () => ({ SttModelPicker: () => null }));
vi.mock("~/settings/ai/llm", () => ({ LlmModelPicker: () => null }));
vi.mock("~/settings/hydration-boundary", () => ({
  SettingsHydrationBoundary: ({ children }: { children: ReactNode }) =>
    children,
}));

vi.mock("~/shared/config", () => ({
  useConfigValues: (keys: readonly string[]) =>
    Object.fromEntries(keys.map((key) => [key, mocks.config[key]])),
}));

vi.mock("~/settings/providers", () => ({
  useAiProviders: (type: string) => mocks.providers[type],
}));

vi.mock("~/settings/ai/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/settings/ai/shared")>()),
  useProviderAvailability: (type: string) => mocks.availability[type],
}));

vi.mock("~/contexts/notifications", () => ({
  useNotifications: () => ({ activeDownloads: mocks.activeDownloads }),
}));

vi.mock("~/settings/ai/stt/health", () => ({
  useConnectionHealth: () => mocks.sttHealth,
}));

vi.mock("~/settings/ai/llm/health", () => ({
  useConnectionHealth: () => mocks.llmHealth,
}));

import { IntelligenceStep, TranscriptionStep } from "./model-setup";

import { usePendingSttSelection } from "~/store/zustand/pending-stt-selection";

beforeEach(() => {
  mocks.config = {};
  mocks.providers = { stt: {}, llm: {} };
  mocks.availability = { stt: {}, llm: {} };
  mocks.activeDownloads = [];
  mocks.sttHealth = { status: null };
  mocks.llmHealth = { status: null };
  usePendingSttSelection.setState({ selection: null, queuedDownloads: [] });
});

afterEach(cleanup);

function continueButton(name: string) {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

function startParakeetDownload(progress: number) {
  mocks.activeDownloads = [
    {
      model: "soniqo-parakeet-batch",
      displayName: "Soniqo Parakeet Batch",
      progress,
    },
  ];
  act(() => {
    usePendingSttSelection.setState({
      selection: { provider: "soniqo", model: "soniqo-parakeet-batch" },
    });
  });
}

test("Continue to Intelligence stays disabled until a transcription model is ready or downloading", () => {
  const view = render(<TranscriptionStep onContinue={vi.fn()} />);
  const rerender = () =>
    view.rerender(<TranscriptionStep onContinue={vi.fn()} />);

  expect(continueButton("Continue to Intelligence").disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toContain(
    "Choose a model to continue",
  );

  startParakeetDownload(42);
  expect(continueButton("Continue to Intelligence").disabled).toBe(false);
  expect(screen.getByRole("status").textContent).toContain(
    "Parakeet Batch · Soniqo · installing 42%",
  );

  mocks.activeDownloads = [];
  act(() => {
    usePendingSttSelection.setState({ selection: null });
  });
  mocks.config = {
    current_stt_provider: "deepgram",
    current_stt_model: "nova-3-general",
  };
  mocks.providers.stt = {
    "stt:deepgram": { type: "stt", base_url: "", api_key: "dg-key" },
  };
  mocks.availability.stt = { deepgram: false };
  mocks.sttHealth = { status: "success" };
  rerender();
  expect(continueButton("Continue to Intelligence").disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toContain(
    "The key was rejected. Check it above.",
  );

  mocks.availability.stt = { deepgram: true };
  rerender();
  expect(continueButton("Continue to Intelligence").disabled).toBe(false);
  expect(screen.getByRole("status").textContent).toContain(
    "Nova 3 · Deepgram · ready",
  );
});

test("Intelligence Continue lets people move on while the transcription model is still downloading", () => {
  const onContinue = vi.fn();
  mocks.config = {
    current_llm_provider: "openai",
    current_llm_model: "gpt-5.5",
  };
  mocks.providers.llm = {
    "llm:openai": {
      type: "llm",
      base_url: "https://api.openai.com/v1",
      api_key: "sk-key",
    },
  };
  mocks.availability.llm = { openai: false };
  render(<IntelligenceStep onBack={vi.fn()} onContinue={onContinue} />);

  startParakeetDownload(42);
  expect(continueButton("Continue").disabled).toBe(true);

  mocks.availability.llm = { openai: true };
  mocks.llmHealth = { status: "success" };
  startParakeetDownload(43);
  expect(continueButton("Continue").disabled).toBe(false);
  expect(screen.getByRole("status").textContent).not.toContain("Transcription");
  act(() => continueButton("Continue").click());
  expect(onContinue).toHaveBeenCalledTimes(1);
});
