import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: "macos",
  settings: {} as Record<string, unknown>,
  configurePasteLast: vi.fn(),
  setTrayPasteLastVisible: vi.fn(),
  insertText: vi.fn(),
  latestDictation: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
  listener: null as ((event: { payload: object }) => void) | null,
}));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => mocks.platform }));
vi.mock("~/settings/queries", () => ({ useSettingsReady: () => true }));
vi.mock("~/shared/config", () => ({
  useConfigValue: (key: string) => mocks.settings[key],
}));
vi.mock("./lifecycle", () => ({
  waitForDictationCleanup: () => Promise.resolve(),
}));
vi.mock("./history/store", () => ({
  latestDictation: mocks.latestDictation,
}));
vi.mock("@anlg/plugin-shortcut", () => ({
  commands: { configurePasteLast: mocks.configurePasteLast },
  events: {
    pasteLastEvent: {
      listen: async (listener: (event: { payload: object }) => void) => {
        mocks.listener = listener;
        return () => {
          if (mocks.listener === listener) mocks.listener = null;
        };
      },
    },
  },
}));
vi.mock("@anlg/plugin-tray", () => ({
  commands: { setTrayPasteLastVisible: mocks.setTrayPasteLastVisible },
}));
vi.mock("@anlg/plugin-dictation", () => ({
  commands: { insertText: mocks.insertText },
}));
vi.mock("@anlg/ui/components/ui/toast", () => ({ toast: mocks.toast }));

import { PasteLastLifecycle, waitForPasteLastCleanup } from "./paste-last";
import { useDictationStatus } from "./state";

async function requestPaste() {
  await waitFor(() => expect(mocks.listener).not.toBeNull());
  await act(async () => {
    mocks.listener?.({ payload: {} });
  });
}

describe("paste last dictation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.platform = "macos";
    mocks.settings = {
      dictation_enabled: true,
      dictation_paste_last_enabled: true,
      dictation_paste_last_shortcut: "Alt+Shift+KeyV",
    };
    for (const fn of [
      mocks.configurePasteLast,
      mocks.setTrayPasteLastVisible,
      mocks.insertText,
    ])
      fn.mockResolvedValue({ status: "ok", data: null });
    mocks.latestDictation.mockResolvedValue(null);
    useDictationStatus.setState({
      capturingShortcut: false,
      phase: "idle",
      capturing: false,
      pending: 0,
      lastTranscript: "Hello again",
    });
  });
  afterEach(async () => {
    cleanup();
    await waitForPasteLastCleanup();
  });

  it("pastes the newest dictation in the history, or this session's while history is off", async () => {
    mocks.latestDictation.mockResolvedValueOnce({
      id: "newest",
      text: "Re-transcribed text",
    });
    render(<PasteLastLifecycle />);
    await requestPaste();
    await waitFor(() =>
      expect(mocks.insertText).toHaveBeenLastCalledWith("Re-transcribed text"),
    );
    await requestPaste();
    await waitFor(() =>
      expect(mocks.insertText).toHaveBeenLastCalledWith("Hello again"),
    );
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("refuses to paste during a capture, but not while dictations only wait to be inserted", async () => {
    useDictationStatus.setState({ phase: "recording", capturing: true });
    render(<PasteLastLifecycle />);
    await requestPaste();
    expect(mocks.toast.error).toHaveBeenCalled();
    expect(mocks.insertText).not.toHaveBeenCalled();

    useDictationStatus.setState({
      phase: "transcribing",
      capturing: false,
      pending: 2,
    });
    await requestPaste();
    await waitFor(() =>
      expect(mocks.insertText).toHaveBeenCalledWith("Hello again"),
    );
  });

  it("releases the shortcut while one is recorded and when paste-last is turned off", async () => {
    const { rerender } = render(<PasteLastLifecycle />);
    await waitFor(() =>
      expect(mocks.configurePasteLast).toHaveBeenLastCalledWith(
        "Alt+Shift+KeyV",
      ),
    );
    act(() => useDictationStatus.setState({ capturingShortcut: true }));
    await waitFor(() =>
      expect(mocks.configurePasteLast).toHaveBeenLastCalledWith(null),
    );
    act(() => useDictationStatus.setState({ capturingShortcut: false }));
    await waitFor(() =>
      expect(mocks.configurePasteLast).toHaveBeenLastCalledWith(
        "Alt+Shift+KeyV",
      ),
    );
    expect(mocks.setTrayPasteLastVisible).toHaveBeenLastCalledWith(true);

    mocks.settings.dictation_paste_last_enabled = false;
    rerender(<PasteLastLifecycle />);
    await waitFor(() =>
      expect(mocks.configurePasteLast).toHaveBeenLastCalledWith(null),
    );
    await waitFor(() =>
      expect(mocks.setTrayPasteLastVisible).toHaveBeenLastCalledWith(false),
    );
    expect(mocks.listener).toBeNull();
  });

  it("pastes from the shortcut on Windows without a tray menu item, which would take the focus", async () => {
    mocks.platform = "windows";
    render(<PasteLastLifecycle />);
    await requestPaste();
    await waitFor(() =>
      expect(mocks.insertText).toHaveBeenCalledWith("Hello again"),
    );
    cleanup();
    await waitForPasteLastCleanup();
    expect(mocks.setTrayPasteLastVisible).not.toHaveBeenCalled();
  });
});
