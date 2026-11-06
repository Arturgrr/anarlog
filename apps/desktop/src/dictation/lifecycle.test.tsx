import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: null as {
    provider: string;
    model: string;
    apiKey: string;
    baseUrl: string;
  } | null,
  platform: "macos",
  settings: {
    dictation_enabled: true,
    dictation_shortcuts: ["Control+Alt+Space"],
    dictation_hands_free: false,
    microphone_device: "",
  } as Record<string, unknown>,
  meeting: { status: "inactive", loading: false },
  configure: vi.fn(),
  setActive: vi.fn(),
  hud: vi.fn(),
  captureTarget: vi.fn(),
  startSystemRecording: vi.fn(),
  stopRecording: vi.fn(),
  cancelRecording: vi.fn(),
  discardRecording: vi.fn(),
  insertText: vi.fn(),
  checkPermission: vi.fn(),
  getCaptureState: vi.fn(),
  runBatch: vi.fn(),
  stopTranscription: vi.fn(),
  unlisten: vi.fn(),
  listener: null as ((event: { payload: { type: string } }) => void) | null,
}));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    constructor(public onmessage: (event: unknown) => void) {}
  },
}));
vi.mock("~/stt/useSTTConnection", () => ({
  useSTTConnection: () => ({
    conn: mocks.connection,
  }),
}));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => mocks.platform }));
vi.mock("~/settings/queries", () => ({ useSettingsReady: () => true }));
vi.mock("~/shared/config", () => ({
  useConfigValue: (key: string) => mocks.settings[key],
}));
vi.mock("~/stt/contexts", () => ({
  useListener: (select: (state: unknown) => unknown) =>
    select({ live: mocks.meeting, stopTranscription: mocks.stopTranscription }),
}));
vi.mock("~/stt/useRunBatch", () => ({ useRunBatch: () => mocks.runBatch }));
vi.mock("@anlg/plugin-shortcut", () => ({
  commands: { configure: mocks.configure, setActive: mocks.setActive },
  events: {
    shortcutEvent: {
      listen: vi.fn(async (listener) => {
        mocks.listener = listener;
        return mocks.unlisten;
      }),
    },
  },
}));
vi.mock("@anlg/plugin-dictation", () => ({
  commands: {
    hud: mocks.hud,
    captureTarget: mocks.captureTarget,
    startSystemRecording: mocks.startSystemRecording,
    stopRecording: mocks.stopRecording,
    cancelRecording: mocks.cancelRecording,
    discardRecording: mocks.discardRecording,
    insertText: mocks.insertText,
  },
}));
vi.mock("@anlg/plugin-permissions", () => ({
  commands: { checkPermission: mocks.checkPermission },
}));
vi.mock("@anlg/plugin-transcription", () => ({
  commands: { getCaptureState: mocks.getCaptureState },
}));
vi.mock("@anlg/ui/components/ui/toast", () => ({
  toast: { error: vi.fn() },
}));

import {
  DictationLifecycle,
  useDictationStatus,
  waitForDictationCleanup,
} from "./lifecycle";

describe("dictation access and lifecycle", () => {
  afterEach(async () => {
    cleanup();
    await waitForDictationCleanup();
  });
  it("retains the last transcript through reconfiguration and clears it when disabled", async () => {
    const { rerender } = render(<DictationLifecycle />);
    await waitFor(() => expect(useDictationStatus.getState().ready).toBe(true));
    useDictationStatus.setState({ lastTranscript: "Recover this text" });
    mocks.settings.dictation_shortcuts = ["Control+Alt+Space", "Fn"];
    rerender(<DictationLifecycle />);
    await waitFor(() =>
      expect(mocks.configure).toHaveBeenLastCalledWith([
        "Control+Alt+Space",
        "Fn",
      ]),
    );
    expect(useDictationStatus.getState().lastTranscript).toBe(
      "Recover this text",
    );
    mocks.settings.dictation_enabled = false;
    rerender(<DictationLifecycle />);
    expect(useDictationStatus.getState().lastTranscript).toBe("");
  });

  it("unregisters dictation while capturing a shortcut and restores it afterwards", async () => {
    render(<DictationLifecycle />);
    await waitFor(() => expect(useDictationStatus.getState().ready).toBe(true));
    act(() => useDictationStatus.setState({ capturingShortcut: true }));
    await waitFor(() => expect(mocks.configure).toHaveBeenLastCalledWith([]));
    expect(useDictationStatus.getState().ready).toBe(false);
    act(() => useDictationStatus.setState({ capturingShortcut: false }));
    await waitFor(() =>
      expect(mocks.configure).toHaveBeenLastCalledWith(["Control+Alt+Space"]),
    );
    expect(mocks.startSystemRecording).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useDictationStatus.setState({ capturingShortcut: false });
    mocks.platform = "macos";
    mocks.connection = null;
    mocks.settings.dictation_live_preview = false;
    mocks.settings.dictation_enabled = true;
    mocks.settings.dictation_shortcuts = ["Control+Alt+Space"];
    mocks.settings.microphone_device = "";
    mocks.meeting = { status: "inactive", loading: false };
    mocks.listener = null;
    for (const fn of [
      mocks.configure,
      mocks.setActive,
      mocks.hud,
      mocks.startSystemRecording,
      mocks.cancelRecording,
      mocks.discardRecording,
      mocks.insertText,
    ])
      fn.mockResolvedValue({ status: "ok", data: null });
    mocks.captureTarget.mockResolvedValue({
      status: "ok",
      data: "focused-field",
    });
    mocks.checkPermission.mockResolvedValue({
      status: "ok",
      data: "authorized",
    });
    mocks.getCaptureState.mockResolvedValue({ status: "ok", data: "inactive" });
    mocks.stopRecording.mockResolvedValue({
      status: "ok",
      data: { filePath: "/tmp/dictation.wav" },
    });
    mocks.stopTranscription.mockResolvedValue(undefined);
    mocks.runBatch.mockImplementation(async (_path, options) =>
      options.handlePersist([{ text: "Hello", start_ms: 0 }]),
    );
    useDictationStatus.setState({
      ready: false,
      phase: "idle",
      lastTranscript: "",
      error: null,
      retry: 0,
      cancel: null,
    });
  });

  it.each(["disabled", "meeting"])(
    "does not register shortcuts when %s",
    async (condition) => {
      if (condition === "disabled") mocks.settings.dictation_enabled = false;
      if (condition === "meeting") mocks.meeting.status = "active";
      render(<DictationLifecycle />);
      await act(async () => {});
      expect(mocks.configure).not.toHaveBeenCalled();
      expect(mocks.startSystemRecording).not.toHaveBeenCalled();
    },
  );

  it("registers without an account or plan and inserts into the captured field", async () => {
    render(<DictationLifecycle />);
    await waitFor(() => expect(useDictationStatus.getState().ready).toBe(true));
    expect(mocks.configure).toHaveBeenCalledWith(["Control+Alt+Space"]);
    await act(async () => {
      mocks.listener?.({ payload: { type: "pressed" } });
    });
    await act(async () => {
      mocks.listener?.({ payload: { type: "released" } });
    });
    await waitFor(() =>
      expect(mocks.insertText).toHaveBeenCalledWith("focused-field", "Hello"),
    );
    expect(mocks.startSystemRecording).toHaveBeenCalledWith(
      null,
      expect.stringMatching(/^system-dictation-/u),
      null,
      expect.anything(),
    );
    expect(mocks.discardRecording).toHaveBeenCalledWith("/tmp/dictation.wav");
  });

  it("shows the HUD before the microphone opens and tells it how the dictation ends", async () => {
    render(<DictationLifecycle />);
    await waitFor(() => expect(useDictationStatus.getState().ready).toBe(true));
    await act(async () => {
      mocks.listener?.({ payload: { type: "pressed" } });
    });
    expect(mocks.hud.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.startSystemRecording.mock.invocationCallOrder[0]!,
    );
    await act(async () => {
      mocks.listener?.({ payload: { type: "released" } });
    });
    await waitFor(() =>
      expect(mocks.hud.mock.calls.map(([event]) => event.type)).toEqual([
        "started",
        "processing",
        "completed",
      ]),
    );

    mocks.hud.mockClear();
    mocks.runBatch.mockImplementation(async () => {});
    await act(async () => {
      mocks.listener?.({ payload: { type: "pressed" } });
    });
    await act(async () => {
      mocks.listener?.({ payload: { type: "released" } });
    });
    await waitFor(() =>
      expect(mocks.hud).toHaveBeenLastCalledWith({ type: "failed" }),
    );

    mocks.hud.mockClear();
    await act(async () => {
      mocks.listener?.({ payload: { type: "pressed" } });
    });
    await act(async () => {
      mocks.listener?.({ payload: { type: "cancelled" } });
    });
    await waitFor(() =>
      expect(mocks.hud).toHaveBeenLastCalledWith({ type: "cancelled" }),
    );
  });

  it("does not record when the HUD cannot show", async () => {
    mocks.hud.mockResolvedValue({ status: "error", error: "no panel" });
    render(<DictationLifecycle />);
    await waitFor(() => expect(useDictationStatus.getState().ready).toBe(true));
    await act(async () => {
      mocks.listener?.({ payload: { type: "pressed" } });
    });
    expect(mocks.startSystemRecording).not.toHaveBeenCalled();
    expect(useDictationStatus.getState().error).toMatch(/indicator/u);
  });

  it("reuses the finalized live transcript even when preview display is disabled", async () => {
    mocks.settings.dictation_live_preview = false;
    mocks.connection = {
      provider: "wisprflow",
      model: "flow",
      apiKey: "test",
      baseUrl: "https://platform-api.wisprflow.ai",
    };
    mocks.stopRecording.mockResolvedValue({
      status: "ok",
      data: { filePath: "/tmp/dictation.wav", transcript: "Finished live." },
    });
    render(<DictationLifecycle />);
    await waitFor(() => expect(useDictationStatus.getState().ready).toBe(true));
    await act(async () => {
      mocks.listener?.({ payload: { type: "pressed" } });
    });
    expect(mocks.startSystemRecording.mock.calls[0]![2]).toEqual(
      expect.objectContaining({ provider: "wisprflow" }),
    );
    const channel = mocks.startSystemRecording.mock.calls[0]![3];
    await act(async () => {
      channel.onmessage({
        type: "transcript",
        text: "Hidden",
        partial: "words",
      });
      channel.onmessage({ type: "previewUnavailable" });
    });
    expect(mocks.hud).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "preview" }),
    );
    await act(async () => {
      mocks.listener?.({ payload: { type: "released" } });
    });
    await waitFor(() =>
      expect(mocks.insertText).toHaveBeenCalledWith(
        "focused-field",
        "Finished live.",
      ),
    );
    expect(mocks.runBatch).not.toHaveBeenCalled();
    expect(mocks.discardRecording).toHaveBeenCalledWith("/tmp/dictation.wav");
  });

  it("aborts and removes shortcuts when dictation is disabled during recording", async () => {
    const view = render(<DictationLifecycle />);
    await waitFor(() => expect(useDictationStatus.getState().ready).toBe(true));
    await act(async () => {
      mocks.listener?.({ payload: { type: "pressed" } });
    });
    await waitFor(() =>
      expect(useDictationStatus.getState().phase).toBe("recording"),
    );
    mocks.settings.dictation_enabled = false;
    view.rerender(<DictationLifecycle />);
    await waitFor(() => expect(mocks.configure).toHaveBeenLastCalledWith([]));
    expect(mocks.cancelRecording).toHaveBeenCalledWith(
      expect.stringMatching(/^system-dictation-/u),
    );
    expect(mocks.insertText).not.toHaveBeenCalled();
    expect(useDictationStatus.getState().lastTranscript).toBe("");
  });

  it("reports missing microphone permission without capturing a target or audio", async () => {
    mocks.checkPermission.mockResolvedValue({ status: "ok", data: "denied" });
    render(<DictationLifecycle />);
    await waitFor(() => expect(useDictationStatus.getState().ready).toBe(true));
    await act(async () => {
      mocks.listener?.({ payload: { type: "pressed" } });
    });
    expect(mocks.hud).not.toHaveBeenCalled();
    expect(mocks.captureTarget).not.toHaveBeenCalled();
    expect(mocks.startSystemRecording).not.toHaveBeenCalled();
    expect(useDictationStatus.getState().error).toMatch(
      /microphone permission/u,
    );
  });

  it.each(["windows", "linux"])(
    "opens the selected microphone on %s without probing a potentially missing default device",
    async (platform) => {
      mocks.platform = platform;
      mocks.settings.microphone_device = "USB microphone";
      mocks.checkPermission.mockResolvedValue({ status: "ok", data: "denied" });
      render(<DictationLifecycle />);
      await waitFor(() =>
        expect(useDictationStatus.getState().ready).toBe(true),
      );
      await act(async () => {
        mocks.listener?.({ payload: { type: "pressed" } });
      });
      expect(mocks.checkPermission).not.toHaveBeenCalled();
      expect(mocks.startSystemRecording).toHaveBeenCalledWith(
        "USB microphone",
        expect.stringMatching(/^system-dictation-/u),
        null,
        expect.anything(),
      );
    },
  );
  it("shows live words without inserting until finish, then ignores stale preview updates", async () => {
    mocks.settings.dictation_live_preview = true;
    mocks.connection = {
      provider: "deepgram",
      model: "nova-3",
      apiKey: "test",
      baseUrl: "https://api.deepgram.com",
    };
    render(<DictationLifecycle />);
    await waitFor(() => expect(useDictationStatus.getState().ready).toBe(true));
    await act(async () => {
      mocks.listener?.({ payload: { type: "pressed" } });
    });
    const channel = mocks.startSystemRecording.mock.calls[0]![3];
    expect(mocks.startSystemRecording.mock.calls[0]![2]).toEqual(
      expect.objectContaining({ provider: "deepgram", apiKey: "test" }),
    );
    await act(async () => {
      channel.onmessage({
        type: "transcript",
        text: "Hello",
        partial: "there",
      });
    });
    expect(mocks.hud).toHaveBeenLastCalledWith({
      type: "preview",
      stable: "Hello",
      tentative: " there",
    });
    expect(mocks.insertText).not.toHaveBeenCalled();
    await act(async () => {
      mocks.listener?.({ payload: { type: "released" } });
    });
    await waitFor(() =>
      expect(mocks.insertText).toHaveBeenCalledWith("focused-field", "Hello"),
    );
    await act(async () => {
      channel.onmessage({ type: "transcript", text: "Stale", partial: "" });
    });
    expect(mocks.hud).toHaveBeenLastCalledWith({ type: "completed" });
    expect(useDictationStatus.getState().lastTranscript).toBe("Hello");
  });

  it("drops preview updates after cancellation and does not transcribe or insert", async () => {
    mocks.settings.dictation_live_preview = true;
    render(<DictationLifecycle />);
    await waitFor(() => expect(useDictationStatus.getState().ready).toBe(true));
    await act(async () => {
      mocks.listener?.({ payload: { type: "pressed" } });
    });
    const channel = mocks.startSystemRecording.mock.calls[0]![3];
    await act(async () => {
      useDictationStatus.getState().cancel?.();
    });
    await waitFor(() =>
      expect(useDictationStatus.getState().phase).toBe("idle"),
    );
    await act(async () => {
      channel.onmessage({
        type: "transcript",
        text: "Cancelled speech",
        partial: "",
      });
    });
    expect(mocks.hud).toHaveBeenLastCalledWith({ type: "cancelled" });
    expect(mocks.runBatch).not.toHaveBeenCalled();
    expect(mocks.insertText).not.toHaveBeenCalled();
  });
  it("streams the live preview to the selected local server", async () => {
    mocks.settings.dictation_live_preview = true;
    mocks.connection = {
      provider: "soniqo",
      model: "soniqo-parakeet-streaming",
      apiKey: "",
      baseUrl: "http://127.0.0.1:1234",
    };
    render(<DictationLifecycle />);
    await waitFor(() => expect(useDictationStatus.getState().ready).toBe(true));
    await act(async () => {
      mocks.listener?.({ payload: { type: "pressed" } });
    });
    expect(mocks.startSystemRecording.mock.calls[0]![2]).toEqual(
      expect.objectContaining({ baseUrl: "http://127.0.0.1:1234", apiKey: "" }),
    );
  });
});
