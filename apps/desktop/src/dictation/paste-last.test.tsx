import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  configurePasteLast: vi.fn(),
  setTrayPasteLastVisible: vi.fn(),
  captureTarget: vi.fn(),
  insertText: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
  listener: null as ((event: { payload: object }) => void) | null,
}));
vi.mock("~/settings/queries", () => ({ useSettingsReady: () => true }));
vi.mock("~/shared/config", () => ({
  useConfigValue: (key: string) => mocks.settings[key],
}));
vi.mock("./lifecycle", () => ({
  waitForDictationCleanup: () => Promise.resolve(),
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
  commands: {
    captureTarget: mocks.captureTarget,
    insertText: mocks.insertText,
  },
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
    mocks.captureTarget.mockResolvedValue({
      status: "ok",
      data: "focused-field",
    });
    useDictationStatus.setState({
      capturingShortcut: false,
      phase: "idle",
      lastTranscript: "Hello again",
    });
  });
  afterEach(async () => {
    cleanup();
    await waitForPasteLastCleanup();
  });

  it("pastes the last dictation into the field focused when it is requested", async () => {
    render(<PasteLastLifecycle />);
    await requestPaste();
    await waitFor(() =>
      expect(mocks.insertText).toHaveBeenCalledWith(
        "focused-field",
        "Hello again",
      ),
    );
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("refuses to paste while a dictation is in progress", async () => {
    useDictationStatus.setState({ phase: "recording" });
    render(<PasteLastLifecycle />);
    await requestPaste();
    expect(mocks.toast.error).toHaveBeenCalled();
    expect(mocks.captureTarget).not.toHaveBeenCalled();
    expect(mocks.insertText).not.toHaveBeenCalled();
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
});
