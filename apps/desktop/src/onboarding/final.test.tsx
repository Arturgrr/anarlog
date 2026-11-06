import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  flushAutomaticRelaunch: vi.fn(),
  getOrCreateWelcomeSession: vi.fn(),
  setOnboardingNeeded: vi.fn(),
  setPendingWelcomeSession: vi.fn(),
  stopSfx: vi.fn(),
  config: {} as Record<string, unknown>,
  activeDownloads: [] as Array<{
    model: string;
    displayName: string;
    progress: number;
  }>,
  isModelDownloaded: vi.fn(),
  downloadModel: vi.fn(),
  setSettingValues: vi.fn(),
}));

vi.mock("@anlg/plugin-local-stt", () => ({
  commands: {
    listSupportedModels: async () => ({
      status: "ok",
      data: [
        {
          key: "soniqo-parakeet-batch",
          display_name: "Parakeet Batch",
          size_bytes: 600 * 1024 * 1024,
        },
      ],
    }),
    isModelDownloaded: mocks.isModelDownloaded,
    isModelDownloading: async () => ({ status: "ok", data: false }),
    downloadModel: mocks.downloadModel,
  },
}));

vi.mock("~/shared/config", () => ({
  useConfigValues: (keys: readonly string[]) =>
    Object.fromEntries(keys.map((key) => [key, mocks.config[key]])),
}));

vi.mock("~/contexts/notifications", () => ({
  useNotifications: () => ({
    activeDownloads: mocks.activeDownloads,
    dismissDownload: vi.fn(),
  }),
}));

vi.mock("~/settings/queries", () => ({
  setSettingValues: mocks.setSettingValues,
}));

vi.mock("~/settings/ai/stt", () => ({ SttModelPicker: () => null }));
vi.mock("~/settings/ai/llm", () => ({ LlmModelPicker: () => null }));
vi.mock("~/settings/ai/stt/health", () => ({
  useConnectionHealth: () => ({ status: null }),
}));
vi.mock("~/settings/ai/llm/health", () => ({
  useConnectionHealth: () => ({ status: null }),
}));

vi.mock("@anlg/plugin-opener2", () => ({
  commands: { openUrl: vi.fn() },
}));

vi.mock("@anlg/plugin-sfx", () => ({
  commands: { stop: mocks.stopSfx },
}));

vi.mock("./welcome-note", () => ({
  getOrCreateWelcomeSession: mocks.getOrCreateWelcomeSession,
  setPendingWelcomeSession: mocks.setPendingWelcomeSession,
}));

vi.mock("~/session/queries", () => ({
  createSession: mocks.createSession,
}));

vi.mock("~/shared/relaunch", () => ({
  flushAutomaticRelaunch: mocks.flushAutomaticRelaunch,
}));

vi.mock("~/types/tauri.gen", () => ({
  commands: { setOnboardingNeeded: mocks.setOnboardingNeeded },
}));

import { FinalSection, FinalStep, finishOnboarding } from "./final";

import { usePendingSttSelection } from "~/store/zustand/pending-stt-selection";
import { localSttQueries } from "~/stt/useLocalSttModel";

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  mocks.config = {
    current_stt_provider: "soniqo",
    current_stt_model: "soniqo-parakeet-batch",
  };
  mocks.activeDownloads = [];
  mocks.isModelDownloaded.mockResolvedValue({ status: "ok", data: false });
  mocks.downloadModel.mockResolvedValue({ status: "ok", data: null });
  mocks.setSettingValues.mockResolvedValue(undefined);
  usePendingSttSelection.setState({
    selection: null,
    queuedDownloads: [],
    failedDownloads: {},
  });
  mocks.flushAutomaticRelaunch.mockResolvedValue(false);
  mocks.getOrCreateWelcomeSession.mockResolvedValue("welcome-session");
  mocks.setOnboardingNeeded.mockResolvedValue({ status: "ok", data: null });
  mocks.stopSfx.mockResolvedValue(null);
});

afterEach(cleanup);

it("opens a blank note when welcome-note creation fails", async () => {
  const onContinue = vi.fn();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getOrCreateWelcomeSession.mockRejectedValueOnce(
    new Error("malformed JSON"),
  );
  mocks.createSession.mockResolvedValueOnce("blank-session");

  await finishOnboarding(onContinue);

  expect(mocks.createSession).toHaveBeenCalledTimes(1);
  expect(onContinue).toHaveBeenCalledWith("blank-session");
  consoleError.mockRestore();
});

it("shows a retryable error when onboarding cannot be persisted", async () => {
  const onContinue = vi.fn();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.setOnboardingNeeded.mockResolvedValueOnce({
    status: "error",
    error: "settings unavailable",
  });

  render(<FinalSection onContinue={onContinue} />);
  fireEvent.click(screen.getByRole("button", { name: "Open Librelog" }));

  expect(
    (
      screen.getByRole("button", {
        name: "Open Librelog",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await screen.findByRole("alert");
  expect(
    (
      screen.getByRole("button", {
        name: "Open Librelog",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  expect(onContinue).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

it("reuses the blank fallback session when persistence is retried", async () => {
  const onContinue = vi.fn();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getOrCreateWelcomeSession.mockRejectedValue(
    new Error("malformed JSON"),
  );
  mocks.createSession.mockResolvedValue("blank-session");
  mocks.setOnboardingNeeded
    .mockResolvedValueOnce({ status: "error", error: "settings unavailable" })
    .mockResolvedValueOnce({ status: "ok", data: null });

  render(<FinalSection onContinue={onContinue} />);
  fireEvent.click(screen.getByRole("button", { name: "Open Librelog" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Open Librelog" }));

  await waitFor(() => {
    expect(onContinue).toHaveBeenCalledWith("blank-session");
  });
  expect(mocks.createSession).toHaveBeenCalledTimes(1);
  consoleError.mockRestore();
});

it("ignores concurrent finish attempts", async () => {
  const onContinue = vi.fn();
  let resolveWelcomeSession: (sessionId: string) => void = () => {};
  mocks.getOrCreateWelcomeSession.mockReturnValue(
    new Promise((resolve) => {
      resolveWelcomeSession = resolve;
    }),
  );

  render(<FinalSection onContinue={onContinue} />);
  const button = screen.getByRole("button", { name: "Open Librelog" });
  fireEvent.click(button);
  fireEvent.click(button);
  resolveWelcomeSession("welcome-session");

  await waitFor(() => {
    expect(onContinue).toHaveBeenCalledWith("welcome-session");
  });
  expect(mocks.getOrCreateWelcomeSession).toHaveBeenCalledTimes(1);
  expect(onContinue).toHaveBeenCalledTimes(1);
});

function renderFinalStep(queryClient = new QueryClient()) {
  render(
    <QueryClientProvider client={queryClient}>
      <FinalStep onBack={vi.fn()} onChangeModel={vi.fn()} onFinish={vi.fn()} />
    </QueryClientProvider>,
  );
  return queryClient;
}

function openButton() {
  return screen.getByRole("button", {
    name: "Open Librelog",
  }) as HTMLButtonElement;
}

it("waits for a downloading model before opening Librelog, then enables the button once it is installed", async () => {
  mocks.activeDownloads = [
    {
      model: "soniqo-parakeet-batch",
      displayName: "Parakeet Batch",
      progress: 42,
    },
  ];
  usePendingSttSelection.setState({
    selection: { provider: "soniqo", model: "soniqo-parakeet-batch" },
  });
  const queryClient = renderFinalStep();

  expect(
    screen.getByRole("heading", { level: 2, name: "Almost ready" }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("progressbar", { name: "Installing Parakeet Batch" })
      .getAttribute("aria-valuenow"),
  ).toBe("42");
  expect(await screen.findByText("42% · ~252 MB / ~600 MB")).toBeTruthy();
  expect(openButton().disabled).toBe(true);
  expect(
    screen.getByText("Opens when the models finish installing"),
  ).toBeTruthy();

  mocks.activeDownloads = [];
  act(() => {
    queryClient.setQueryData(
      localSttQueries.isDownloaded("soniqo-parakeet-batch").queryKey,
      { status: "ok", data: true },
    );
    usePendingSttSelection.setState({ selection: null });
  });

  expect(
    screen.getByRole("heading", { level: 2, name: "Ready to go" }),
  ).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(openButton().disabled).toBe(false);
});

it("offers to resume a download that a restart interrupted", async () => {
  renderFinalStep();

  fireEvent.click(
    await screen.findByRole("button", { name: "Resume download" }),
  );

  expect(openButton().disabled).toBe(true);
  await waitFor(() =>
    expect(mocks.downloadModel).toHaveBeenCalledWith("soniqo-parakeet-batch"),
  );
  expect(mocks.setSettingValues).toHaveBeenCalledWith({
    current_stt_provider: "soniqo",
    current_stt_model: "soniqo-parakeet-batch",
  });
  expect(usePendingSttSelection.getState().selection).toEqual({
    provider: "soniqo",
    model: "soniqo-parakeet-batch",
  });
});
