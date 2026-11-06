import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  providers: {} as Record<string, unknown>,
  availability: {} as Record<string, boolean | undefined>,
  activeDownloads: [] as Array<{
    model: string;
    displayName: string;
    progress: number;
  }>,
  setAiProvider: vi.fn(),
  setSettingValues: vi.fn(),
  cancelDownload: vi.fn(),
  dismissDownload: vi.fn(),
}));

vi.mock("~/settings/providers", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  return {
    useAiProvidersState: () => ({
      providers: mocks.providers,
      isReady: true,
      isLoading: false,
    }),
    useAiProviders: () => mocks.providers,
    useSetAiProvider: (type: string, providerId: string) =>
      useMutation({
        mutationFn: async (changes: unknown) =>
          mocks.setAiProvider(type, providerId, changes),
      }),
    useClearAiProvider: () => useMutation({ mutationFn: async () => {} }),
    isKeychainAccessError: () => false,
    repairKeychainAccess: vi.fn(),
  };
});

vi.mock("~/settings/ai/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/settings/ai/shared")>()),
  useProviderAvailability: () => mocks.availability,
}));

vi.mock("~/shared/config", () => ({
  useConfigValue: (key: string) => mocks.config[key],
  useConfigValues: (keys: readonly string[]) =>
    Object.fromEntries(keys.map((key) => [key, mocks.config[key]])),
}));

vi.mock("~/settings/queries", () => ({
  setSettingValues: mocks.setSettingValues,
  setSettingValue: vi.fn(),
  useSetSettingValues: () => mocks.setSettingValues,
}));

vi.mock("./health", () => ({
  useConnectionHealth: () => ({ status: "success" }),
}));

vi.mock("~/contexts/notifications", () => ({
  useNotifications: () => ({
    activeDownloads: mocks.activeDownloads,
    dismissDownload: mocks.dismissDownload,
  }),
}));

vi.mock("~/store/zustand/tabs", () => ({
  useTabs: (selector: (state: { openNew: () => void }) => unknown) =>
    selector({ openNew: vi.fn() }),
}));

vi.mock("@anlg/plugin-misc", () => ({
  commands: {
    getDeviceInfo: async () => ({
      status: "ok",
      data: { platform: "macos", arch: "aarch64", totalMemoryBytes: 16e9 },
    }),
  },
}));

vi.mock("@anlg/plugin-local-stt", () => ({
  commands: {
    listSupportedModels: async () => ({
      status: "ok",
      data: [
        {
          key: "soniqo-parakeet-streaming",
          display_name: "Parakeet Streaming",
          description: "Shows text while the meeting happens.",
          size_bytes: 120e6,
          model_type: "soniqo",
          supports_realtime: true,
          recommended_memory_bytes: 8e9,
        },
        {
          key: "soniqo-parakeet-batch",
          display_name: "Parakeet Batch",
          description: "Transcribes when the meeting ends.",
          size_bytes: 632e6,
          model_type: "soniqo",
          supports_realtime: false,
          recommended_memory_bytes: 16e9,
        },
      ],
    }),
    isModelDownloaded: async () => ({ status: "ok", data: false }),
    downloadModel: async () => ({ status: "ok", data: null }),
    cancelDownload: mocks.cancelDownload,
  },
}));

const PORTUGUESE_PROVIDERS = new Set(["soniqo", "deepgram"]);

vi.mock("~/stt/capabilities", async (importOriginal) => {
  const isSupported = async (
    provider: string,
    _model: unknown,
    languages: readonly string[],
  ) =>
    languages.every(
      (language) => language !== "pt" || PORTUGUESE_PROVIDERS.has(provider),
    );
  return {
    ...(await importOriginal<typeof import("~/stt/capabilities")>()),
    isSupportedLanguagesLive: isSupported,
    isSupportedLanguagesBatch: isSupported,
  };
});

import { STT } from "./index";

import { usePendingSttSelection } from "~/store/zustand/pending-stt-selection";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config = {
    ai_language: "pt",
    spoken_languages: [],
    local_stt_model_path: "",
  };
  mocks.providers = {};
  mocks.availability = {};
  mocks.activeDownloads = [];
  mocks.setAiProvider.mockResolvedValue(undefined);
  mocks.cancelDownload.mockResolvedValue({ status: "ok", data: false });
  mocks.dismissDownload.mockImplementation((model: string) => {
    mocks.activeDownloads = mocks.activeDownloads.filter(
      (download) => download.model !== model,
    );
  });
  usePendingSttSelection.setState({ selection: null, queuedDownloads: [] });
});

afterEach(cleanup);

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <STT />
    </QueryClientProvider>,
  );
}

function providerList() {
  return screen.getByRole("navigation", { name: "Transcription providers" });
}

describe("Transcription settings", () => {
  test("an unconfigured provider can be focused and configured from the list", async () => {
    renderPage();

    fireEvent.click(
      await within(providerList()).findByRole("button", { name: /Deepgram/ }),
    );
    expect(
      screen.getByRole("heading", { level: 3, name: "Deepgram" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: "Nova 3" }).hasAttribute("disabled"),
    ).toBe(true);

    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "dg-key" },
    });

    await waitFor(() =>
      expect(mocks.setAiProvider).toHaveBeenCalledWith(
        "stt",
        "deepgram",
        expect.objectContaining({ api_key: "dg-key" }),
      ),
    );
  });

  test("selecting a model persists the provider and model", async () => {
    mocks.providers = {
      "stt:deepgram": {
        type: "stt",
        base_url: "https://api.deepgram.com/v1",
        api_key: "saved-key",
      },
    };
    mocks.availability = { deepgram: true };
    mocks.config.current_stt_provider = "deepgram";
    mocks.config.current_stt_model = "nova-3-general";
    renderPage();

    fireEvent.click(
      await screen.findByRole("radio", { name: "Flux General Multilingual" }),
    );

    expect(mocks.setSettingValues).toHaveBeenCalledWith({
      current_stt_provider: "deepgram",
      current_stt_model: "flux-general-multi",
    });
  });

  test("filters narrow the providers to those on this Mac that transcribe Portuguese", async () => {
    renderPage();
    await within(providerList()).findByRole("button", { name: /Soniqo/ });

    fireEvent.click(screen.getByRole("button", { name: "On this Mac" }));
    const local = within(providerList());
    expect(local.queryByRole("button", { name: /Deepgram/ })).toBeNull();
    expect(local.getByRole("button", { name: /BYO-model/ })).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Transcribes Portuguese" }),
    );
    await waitFor(() =>
      expect(
        within(providerList()).queryByRole("button", { name: /BYO-model/ }),
      ).toBeNull(),
    );
    expect(
      within(providerList()).getByRole("button", { name: /Soniqo/ }),
    ).toBeTruthy();
  });

  test("a local download can be cancelled", async () => {
    mocks.activeDownloads = [
      {
        model: "soniqo-parakeet-batch",
        displayName: "Parakeet Batch",
        progress: 42,
      },
    ];
    usePendingSttSelection.setState({
      selection: { provider: "soniqo", model: "soniqo-parakeet-batch" },
      queuedDownloads: [],
    });
    renderPage();

    fireEvent.click(
      await within(providerList()).findByRole("button", { name: /Soniqo/ }),
    );
    expect(
      screen.getByRole("progressbar", { name: "Downloading Parakeet Batch" }),
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel download" }));
    });

    expect(mocks.cancelDownload).toHaveBeenCalledWith("soniqo-parakeet-batch");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download Parakeet Batch" }),
      ).toBeTruthy(),
    );
    expect(usePendingSttSelection.getState().selection).toBeNull();
  });
});
