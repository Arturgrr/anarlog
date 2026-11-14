import { describe, expect, it, vi } from "vitest";

import {
  BUSY_RETRY_MS,
  createAnnotateFlow,
  narrationMicrophone,
  NO_SPEECH,
  PASTE_GAP_MS,
  shellEscapePath,
  TRANSCRIPTION_BUSY,
  type AnnotateDeps,
} from "./flow";
import { annotateRuns } from "./state";

const stopped = {
  id: "annotation-1",
  dir: "/data/annotations/annotation-1",
  audioPath: "/data/annotations/annotation-1/audio.wav",
  durationMs: 4_000,
  endedBy: "stop",
  warnings: [],
};
const finalized = {
  id: "annotation-1",
  dir: stopped.dir,
  summary: "# Annotation\n\n1. Look here.",
  contactSheet: `${stopped.dir}/contact-sheet.png`,
};

function setup(overrides: Partial<AnnotateDeps["plugin"]> = {}) {
  const calls: string[] = [];
  const notify = {
    ready: vi.fn(),
    screenRecordingDenied: vi.fn(),
    needsRestart: vi.fn(),
    microphoneDenied: vi.fn(),
    transcriptionFailed: vi.fn(),
    transcriptionWaiting: vi.fn(),
    nothingToPaste: vi.fn(),
    error: vi.fn(),
  };
  const plugin: AnnotateDeps["plugin"] = {
    status: vi.fn(async () => ({
      available: true,
      phase: "idle" as const,
      stopped: null,
    })),
    screenRecording: vi.fn(async () => "granted"),
    requestScreenRecording: vi.fn(async () => true),
    start: vi.fn(async () => ({ id: stopped.id, dir: stopped.dir })),
    stop: vi.fn(async () => stopped),
    finalize: vi.fn(async () => finalized),
    cancel: vi.fn(async () => {}),
    setInkMode: vi.fn(async () => {}),
    latest: vi.fn(async () => finalized),
    ...overrides,
  };
  const deps: AnnotateDeps = {
    plugin,
    microphoneAuthorized: vi.fn(async () => true),
    transcribe: vi.fn(async () => ({
      provider: "deepgram",
      text: "Look here.",
      words: [{ startMs: 100, endMs: 400, text: " Look" }],
    })),
    copy: vi.fn(async () => {}),
    insert: vi.fn(async (text: string) => {
      calls.push(`insert:${text}`);
    }),
    sleep: vi.fn(async (ms: number) => {
      calls.push(`sleep:${ms}`);
    }),
    setRecording: vi.fn(async () => {}),
    notify,
    onPhase: vi.fn(),
  };
  return { flow: createAnnotateFlow(deps), deps, plugin, notify, calls };
}

describe("Annotate flow", () => {
  it("records, transcribes, finalizes and leaves the summary on the clipboard", async () => {
    const { flow, deps, plugin, notify } = setup();
    await flow.onShortcut("start");
    expect(flow.phase).toBe("recording");
    expect(deps.setRecording).toHaveBeenLastCalledWith(true);

    await flow.onShortcut("stop");
    expect(deps.transcribe).toHaveBeenCalledWith(stopped.audioPath);
    expect(plugin.finalize).toHaveBeenCalledWith(
      stopped.id,
      expect.objectContaining({ text: "Look here." }),
    );
    expect(deps.copy).toHaveBeenCalledWith(finalized.summary);
    expect(notify.ready).toHaveBeenCalledWith(finalized);
    expect(flow.phase).toBe("idle");
    expect(deps.setRecording).toHaveBeenLastCalledWith(false);
  });

  it("asks for Screen Recording once and stops at a denial or a needed relaunch", async () => {
    const answers = ["not_determined", "denied"];
    const denied = setup({
      screenRecording: vi.fn(async () => answers.shift() ?? "denied"),
    });
    await denied.flow.start();
    expect(denied.plugin.requestScreenRecording).toHaveBeenCalledOnce();
    expect(denied.notify.screenRecordingDenied).toHaveBeenCalled();
    expect(denied.plugin.start).not.toHaveBeenCalled();
    expect(denied.flow.phase).toBe("idle");

    const restart = setup({
      screenRecording: vi.fn(async () => "needs_restart"),
    });
    await restart.flow.start();
    expect(restart.notify.needsRestart).toHaveBeenCalled();
    expect(restart.plugin.start).not.toHaveBeenCalled();
  });

  it("still finalizes without a transcript when transcription fails", async () => {
    const { flow, deps, plugin, notify } = setup();
    vi.mocked(deps.transcribe).mockRejectedValue(new Error("no provider"));
    await flow.start();
    await flow.stop();
    expect(notify.transcriptionFailed).toHaveBeenCalled();
    expect(plugin.finalize).toHaveBeenCalledWith(stopped.id, null);
    expect(notify.ready).toHaveBeenCalledWith(finalized);
    expect(flow.phase).toBe("idle");
  });

  it("finalizes a recording the capsule or the cap stopped, once", async () => {
    const { flow, plugin } = setup({
      stop: vi.fn(async () => {
        throw new Error("No annotation is recording.");
      }),
    });
    await flow.start();
    // The shortcut's stop lost the race to the capsule's.
    await flow.stop();
    await flow.onEvent({ type: "stopped", stopped });
    expect(plugin.finalize).toHaveBeenCalledOnce();
    expect(flow.phase).toBe("idle");
  });

  it("returns to idle when finalizing fails", async () => {
    const { flow, notify } = setup({
      finalize: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });
    await flow.start();
    await flow.stop();
    expect(notify.error).toHaveBeenCalled();
    expect(flow.phase).toBe("idle");
  });

  it("pastes the contact sheet's path, pauses, then the summary", async () => {
    const { flow, calls, notify, plugin } = setup();
    await flow.pasteLast();
    expect(calls).toEqual([
      `insert:${shellEscapePath(finalized.contactSheet)}`,
      `sleep:${PASTE_GAP_MS}`,
      `insert:${finalized.summary}`,
    ]);

    vi.mocked(plugin.latest).mockResolvedValue(null);
    await flow.pasteLast();
    expect(notify.nothingToPaste).toHaveBeenCalled();
  });

  it("escapes a pasted path as Terminal's drag and drop does", () => {
    expect(
      shellEscapePath(
        "/Users/a/Library/Application Support/Librelog (1)/it's.png",
      ),
    ).toBe(
      "/Users/a/Library/Application\\ Support/Librelog\\ \\(1\\)/it\\'s.png",
    );
    expect(shellEscapePath("/a/b-c_d.e@f+g:h/é.png")).toBe(
      "/a/b-c_d.e@f+g:h/é.png",
    );
  });

  it("stops a recording whose stop was pressed while it was starting", async () => {
    let started!: () => void;
    const { flow, plugin } = setup({
      start: vi.fn(
        () =>
          new Promise<{ id: string; dir: string }>((resolve) => {
            started = () => resolve({ id: stopped.id, dir: stopped.dir });
          }),
      ),
    });
    const starting = flow.start();
    await vi.waitFor(() => expect(plugin.start).toHaveBeenCalled());
    await flow.onShortcut("stop");
    expect(plugin.stop).not.toHaveBeenCalled();
    started();
    await starting;
    expect(plugin.stop).toHaveBeenCalledOnce();
    expect(plugin.finalize).toHaveBeenCalledOnce();
    expect(flow.phase).toBe("idle");
  });

  it("goes back to idle when the stop finds nothing recording and no event follows", async () => {
    const { flow, notify } = setup({
      stop: vi.fn(async () => {
        throw new Error("No annotation is recording.");
      }),
    });
    await flow.start();
    await flow.stop();
    expect(flow.phase).toBe("idle");
    expect(notify.error).not.toHaveBeenCalled();
  });

  it("treats a discarded stop as quiet", async () => {
    const { flow, notify } = setup({
      stop: vi.fn(async () => {
        throw new Error("The annotation was cancelled.");
      }),
    });
    await flow.start();
    await flow.stop();
    expect(notify.error).not.toHaveBeenCalled();
    expect(flow.phase).toBe("idle");
  });

  it("finalizes without words and without a warning when nothing was said", async () => {
    const { flow, deps, plugin, notify } = setup();
    vi.mocked(deps.transcribe).mockRejectedValue(new Error(NO_SPEECH));
    await flow.start();
    await flow.stop();
    expect(notify.transcriptionFailed).not.toHaveBeenCalled();
    expect(plugin.finalize).toHaveBeenCalledWith(stopped.id, null);
    expect(notify.ready).toHaveBeenCalledWith(finalized);
  });

  it("waits for a local transcription busy with a meeting's recording, then finalizes with the words", async () => {
    const { flow, deps, plugin, notify } = setup();
    vi.mocked(deps.transcribe)
      .mockRejectedValueOnce(TRANSCRIPTION_BUSY)
      .mockRejectedValueOnce(TRANSCRIPTION_BUSY);
    await flow.start();
    await flow.stop();
    expect(deps.sleep).toHaveBeenCalledWith(BUSY_RETRY_MS);
    expect(notify.transcriptionWaiting).toHaveBeenCalledOnce();
    expect(notify.transcriptionFailed).not.toHaveBeenCalled();
    expect(plugin.finalize).toHaveBeenCalledWith(
      stopped.id,
      expect.objectContaining({ text: "Look here." }),
    );

    // A model that stays busy: the annotation is still finalized, without words.
    const busy = setup();
    vi.mocked(busy.deps.transcribe).mockRejectedValue(TRANSCRIPTION_BUSY);
    await busy.flow.start();
    await busy.flow.stop();
    expect(busy.notify.transcriptionFailed).toHaveBeenCalledOnce();
    expect(busy.plugin.finalize).toHaveBeenCalledWith(stopped.id, null);
    expect(busy.flow.phase).toBe("idle");
  });

  it("narrates into the microphone a meeting records, else the chosen one", async () => {
    expect(
      await narrationMicrophone(
        async () => "MacBook Pro Microphone",
        "AirPods",
      ),
    ).toBe("MacBook Pro Microphone");
    // No meeting, or one that records no microphone.
    expect(
      await narrationMicrophone(async () => {
        throw new Error("actor not found: active source");
      }, "AirPods"),
    ).toBe("AirPods");
    expect(await narrationMicrophone(async () => null, null)).toBeNull();
  });

  it("retries a failed finalize once with the same words", async () => {
    const finalize = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(finalized);
    const { flow, deps, plugin, notify } = setup({
      finalize,
      status: vi.fn(async () => ({
        available: true,
        phase: "finishing" as const,
        stopped,
      })),
    });
    await flow.start();
    await flow.stop();
    expect(plugin.finalize).toHaveBeenCalledTimes(2);
    expect(deps.transcribe).toHaveBeenCalledOnce();
    expect(notify.error).not.toHaveBeenCalled();
    expect(notify.ready).toHaveBeenCalledWith(finalized);
  });

  it("keeps running after Annotate is turned off until the session is idle", () => {
    expect(annotateRuns(true, "idle")).toBe(true);
    expect(annotateRuns(false, "recording")).toBe(true);
    expect(annotateRuns(false, "transcribing")).toBe(true);
    expect(annotateRuns(false, "idle")).toBe(false);
  });
});
