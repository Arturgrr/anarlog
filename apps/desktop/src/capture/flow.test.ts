import { describe, expect, it, vi } from "vitest";

import type { CaptureEntry, RecordingStart } from "@anlg/plugin-capture";

import {
  BUSY,
  type CaptureDeps,
  type CaptureSettings,
  createCaptureFlow,
} from "./flow";

const settings: CaptureSettings = {
  copy: true,
  saveToFolder: true,
  folder: "/Users/me/Pictures",
  showCard: true,
  openEditor: false,
  imageFormat: "png",
  showCursor: false,
  recordFps: 30,
  recordCursor: true,
  microphone: false,
  systemAudio: false,
  countdown: 0,
  gifFps: 15,
  gifMaxWidth: 720,
};

const labels = {
  areaHint: "drag",
  windowHint: "click",
  discardQuestion: null,
  discard: null,
  keep: null,
  copy: null,
  save: null,
  show: null,
  edit: null,
  close: null,
};

const entry: CaptureEntry = {
  id: "cap-1-abcd",
  kind: "screenshot",
  path: "/Users/me/Pictures/Librelog Screenshot.png",
  thumbnailPath: "/data/captures/thumbs/cap-1-abcd.png",
  createdMs: 1,
  width: 200,
  height: 100,
  scale: 2,
  durationMs: 0,
  bytes: 1000,
  inLibrary: false,
};

function setup(
  overrides: Partial<CaptureDeps["plugin"]> = {},
  current: Partial<CaptureSettings> = {},
) {
  const notify = {
    captured: vi.fn(),
    screenRecordingDenied: vi.fn(),
    needsRestart: vi.fn(),
    microphoneDenied: vi.fn(),
    error: vi.fn(),
  };
  const plugin: CaptureDeps["plugin"] = {
    status: vi.fn(async () => ({
      available: true,
      phase: "idle" as const,
      elapsedMs: 0,
    })),
    screenRecording: vi.fn(async () => "granted"),
    requestScreenRecording: vi.fn(async () => true),
    screenshot: vi.fn(async () => ({ status: "captured" as const, entry })),
    startRecording: vi.fn(async (request) => ({
      status: "recording" as const,
      output: request.output,
    })),
    stopRecording: vi.fn(async () => ({
      status: "captured" as const,
      entry: { ...entry, kind: "video" as const },
    })),
    listCaptures: vi.fn(async () => [entry]),
    cancelRecording: vi.fn(async () => {}),
    ...overrides,
  };
  const deps: CaptureDeps = {
    plugin,
    settings: () => ({ ...settings, ...current }),
    labels: () => labels,
    microphoneAuthorized: vi.fn(async () => true),
    frontmost: vi.fn(async () => true),
    openEditor: vi.fn(async () => {}),
    openFile: vi.fn(async () => {}),
    notify,
    onPhase: vi.fn(),
  };
  return { flow: createCaptureFlow(deps), deps, plugin, notify };
}

describe("Capture flow", () => {
  it("takes a screenshot built from the settings once Screen Recording is allowed", async () => {
    const { flow, plugin } = setup();
    await flow.onShortcut("area");
    expect(plugin.screenshot).toHaveBeenCalledWith({
      mode: "area",
      format: "png",
      showCursor: false,
      copy: true,
      saveDir: "/Users/me/Pictures",
      folder: "/Users/me/Pictures",
      showCard: true,
      labels,
    });
    expect(flow.phase).toBe("idle");
  });

  it.each([
    [
      { saveToFolder: false, folder: "/Users/me/Pictures" },
      null,
      "/Users/me/Pictures",
    ],
    [{ saveToFolder: true, folder: "" }, "", null],
    [{ saveToFolder: false, folder: "" }, null, null],
  ])(
    "keeps a capture in the library when saving is off and uses Downloads without a folder (%o)",
    async (current, saveDir, folder) => {
      const { flow, plugin } = setup({}, current);
      await flow.onShortcut("fullscreen");
      expect(plugin.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "fullscreen", saveDir, folder }),
      );
    },
  );

  it("asks for Screen Recording once and takes nothing when it is denied", async () => {
    const answers = ["not_determined", "denied"];
    const { flow, plugin, notify } = setup({
      screenRecording: vi.fn(async () => answers.shift() ?? "denied"),
    });
    await flow.onShortcut("area");
    expect(plugin.requestScreenRecording).toHaveBeenCalledOnce();
    expect(notify.screenRecordingDenied).toHaveBeenCalled();
    expect(plugin.screenshot).not.toHaveBeenCalled();
    expect(flow.phase).toBe("idle");
  });

  it("stops the running recording when a record shortcut is pressed again, whatever its output", async () => {
    for (const second of ["record", "gif"] as const) {
      const { flow, plugin } = setup();
      await flow.onShortcut("record");
      expect(plugin.startRecording).toHaveBeenCalledWith(
        expect.objectContaining({ output: "mp4", fps: 30, showCursor: true }),
      );
      expect(flow.phase).toBe("recording");

      await flow.onShortcut(second);
      expect(plugin.stopRecording).toHaveBeenCalledOnce();
      expect(plugin.startRecording).toHaveBeenCalledOnce();
      expect(flow.phase).toBe("idle");
    }
  });

  it("does not start a recording with the microphone until it is allowed", async () => {
    const { flow, deps, plugin, notify } = setup({}, { microphone: true });
    vi.mocked(deps.microphoneAuthorized).mockResolvedValue(false);
    await flow.onShortcut("gif");
    expect(notify.microphoneDenied).toHaveBeenCalled();
    expect(plugin.startRecording).not.toHaveBeenCalled();
    expect(flow.phase).toBe("idle");
  });

  it("opens the editor for a card's edit and the file for a card's open", async () => {
    const { flow, deps } = setup();
    await flow.onEvent({ type: "cardAction", id: entry.id, action: "edit" });
    expect(deps.openEditor).toHaveBeenCalledWith(entry.id);
    await flow.onEvent({ type: "cardAction", id: entry.id, action: "open" });
    expect(deps.openFile).toHaveBeenCalledWith(entry.path);
  });

  it("opens the editor after a screenshot when asked, and tells about a capture no card shows", async () => {
    const editor = setup({}, { openEditor: true });
    await editor.flow.onEvent({ type: "captured", entry });
    expect(editor.deps.openEditor).toHaveBeenCalledWith(entry.id);

    const noCard = setup({}, { showCard: false });
    await noCard.flow.onEvent({ type: "captured", entry });
    expect(noCard.notify.captured).toHaveBeenCalledWith(entry, true);
  });

  it("surfaces a rejected command and takes the plugin's phase back", async () => {
    const { flow, plugin, notify } = setup({
      startRecording: vi.fn(async () => {
        throw new Error("Could not capture the screen: stream");
      }),
    });
    await flow.onShortcut("record");
    expect(notify.error).toHaveBeenCalledWith(
      new Error("Could not capture the screen: stream"),
    );
    expect(plugin.status).toHaveBeenCalled();
    expect(flow.phase).toBe("idle");
  });

  it("ignores a press the plugin is too busy for without a toast", async () => {
    const { flow, plugin, notify } = setup({
      screenshot: vi.fn(async () => {
        throw new Error(BUSY);
      }),
      status: vi.fn(async () => ({
        available: true,
        phase: "selecting" as const,
        elapsedMs: 0,
      })),
    });
    await flow.onShortcut("area");
    expect(notify.error).not.toHaveBeenCalled();
    expect(flow.phase).toBe("selecting");

    await flow.onShortcut("window");
    expect(plugin.screenshot).toHaveBeenCalledOnce();
  });

  it("cancels a recording whose selector is still up when its shortcut is pressed again", async () => {
    let resolve: (value: { status: "cancelled" }) => void = () => {};
    const { flow, plugin } = setup({
      startRecording: vi.fn(
        () => new Promise<RecordingStart>((done) => (resolve = done)),
      ),
      cancelRecording: vi.fn(async () => resolve({ status: "cancelled" })),
    });
    const starting = flow.onShortcut("record");
    await vi.waitFor(() => expect(plugin.startRecording).toHaveBeenCalled());

    await flow.onShortcut("gif");
    await starting;
    expect(plugin.cancelRecording).toHaveBeenCalledOnce();
    expect(plugin.stopRecording).not.toHaveBeenCalled();
    expect(plugin.startRecording).toHaveBeenCalledOnce();
    expect(flow.phase).toBe("idle");
  });
});
