import { afterEach, describe, expect, it, vi } from "vitest";

import { DictationController } from "./controller";

const said = (text: string) => ({
  text,
  provider: "deepgram",
  model: "nova-3",
  language: "ko,en",
});

function setup(handsFree = false) {
  let recordings = 0;
  const dependencies = {
    handsFree,
    start: vi.fn().mockResolvedValue("capture"),
    stop: vi.fn(async () => ({
      filePath: `/tmp/dictation-${++recordings}.wav`,
      durationMs: 1_000,
      transcript: null,
    })),
    cancel: vi.fn().mockResolvedValue(undefined),
    transcribe: vi.fn().mockResolvedValue(said("안녕하세요, world.")),
    insert: vi.fn().mockResolvedValue(undefined),
    discard: vi.fn().mockResolvedValue(undefined),
    onJobFinished: vi.fn().mockResolvedValue({ claimedAudio: false }),
    onStatus: vi.fn(),
    onTranscript: vi.fn(),
    onError: vi.fn(),
  };
  return { ...dependencies, controller: new DictationController(dependencies) };
}

function gate<T>() {
  let open!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const status = (state: ReturnType<typeof setup>) =>
  state.onStatus.mock.lastCall?.[0];

const settle = async (state: ReturnType<typeof setup>, phase = "idle") => {
  await vi.waitFor(() => expect(status(state)?.phase).toBe(phase));
};

/** Records one dictation and leaves it to the queue. */
const dictate = async (state: ReturnType<typeof setup>) => {
  state.controller.press();
  await vi.waitFor(() => expect(status(state)?.phase).toBe("recording"));
  if (state.handsFree) state.controller.press();
  else state.controller.release();
};

describe("system dictation", () => {
  afterEach(() => vi.useRealTimers());

  it("finishes a shortcut released while the microphone is still starting", async () => {
    const state = setup();
    state.controller.press();
    state.controller.release();
    await settle(state);
    expect(state.insert).toHaveBeenCalledWith("안녕하세요, world.");
    expect(state.discard).toHaveBeenCalledWith("/tmp/dictation-1.wav");
  });

  it("toggles hands-free recording and ignores key release", async () => {
    const state = setup(true);
    state.controller.press();
    state.controller.release();
    await settle(state, "recording");
    expect(state.stop).not.toHaveBeenCalled();
    state.controller.press();
    await settle(state);
    expect(state.insert).toHaveBeenCalledOnce();
  });

  it("cancels a pending microphone start without transcribing", async () => {
    const state = setup();
    state.controller.press();
    await state.controller.cancelCapture();
    expect(state.cancel).toHaveBeenCalledOnce();
    expect(state.transcribe).not.toHaveBeenCalled();
    expect(state.insert).not.toHaveBeenCalled();
    expect(status(state)?.phase).toBe("idle");
  });

  it("never cancels another recorder when its start was rejected", async () => {
    const state = setup();
    state.start.mockRejectedValueOnce(new Error("Already recording"));
    state.controller.press();
    await settle(state);
    expect(state.cancel).not.toHaveBeenCalled();
    expect(state.onError).toHaveBeenCalledOnce();
  });

  it("cancelling everything stops the capture, drops every pending dictation and removes each recording", async () => {
    const state = setup();
    const late = gate<ReturnType<typeof said>>();
    state.transcribe.mockReturnValueOnce(late.promise);
    await dictate(state);
    await vi.waitFor(() => expect(state.transcribe).toHaveBeenCalled());
    await dictate(state);
    state.controller.press();
    await settle(state, "recording");
    const cancelled = state.controller.cancel();
    late.open(said("Do not insert this"));
    await cancelled;
    expect(state.cancel).toHaveBeenCalledOnce();
    expect(state.insert).not.toHaveBeenCalled();
    expect(state.onTranscript).not.toHaveBeenCalled();
    expect(state.onError).not.toHaveBeenCalled();
    expect(state.discard.mock.calls).toEqual([
      ["/tmp/dictation-1.wav"],
      ["/tmp/dictation-2.wav"],
    ]);
    expect(
      state.onJobFinished.mock.calls.map(([job]) => job.cancelled),
    ).toEqual([true, true]);
    expect(status(state)).toEqual({
      phase: "idle",
      capturing: false,
      pending: 0,
    });
    expect(state.onStatus.mock.lastCall?.[1]).toBe("cancelled");
  });

  it("keeps the transcript recoverable when the focused field changed", async () => {
    const state = setup();
    state.insert.mockRejectedValueOnce(new Error("Focus changed"));
    state.controller.press();
    state.controller.release();
    await settle(state);
    expect(state.onTranscript).toHaveBeenCalledWith("안녕하세요, world.");
    expect(state.onError).toHaveBeenCalledOnce();
    expect(state.discard).toHaveBeenCalledOnce();
  });

  it("cleans up failed and silent transcriptions without inserting", async () => {
    for (const transcript of [
      Promise.reject(new Error("Network unavailable")),
      Promise.resolve(said("  ")),
    ]) {
      const state = setup();
      state.transcribe.mockReturnValueOnce(transcript);
      state.controller.press();
      state.controller.release();
      await settle(state);
      expect(state.insert).not.toHaveBeenCalled();
      expect(state.discard).toHaveBeenCalledOnce();
      expect(state.onError).toHaveBeenCalledOnce();
    }
  });

  it("hands every finished dictation, silent ones included, to history before its audio is removed", async () => {
    const state = setup();
    const finished = gate<{ claimedAudio: boolean }>();
    state.onJobFinished.mockReturnValueOnce(finished.promise);
    state.transcribe.mockResolvedValueOnce(said(" "));
    await dictate(state);
    await vi.waitFor(() => expect(state.onJobFinished).toHaveBeenCalled());
    expect(state.onJobFinished).toHaveBeenLastCalledWith({
      id: expect.any(String),
      createdAt: expect.any(String),
      durationMs: 1_000,
      context: "capture",
      provider: "deepgram",
      model: "nova-3",
      language: "ko,en",
      rawText: "",
      finalText: "",
      inserted: false,
      cancelled: false,
      audioPath: "/tmp/dictation-1.wav",
      error: expect.stringMatching(/no speech/iu),
    });
    expect(state.discard).not.toHaveBeenCalled();
    finished.open({ claimedAudio: false });
    await vi.waitFor(() =>
      expect(state.discard).toHaveBeenCalledWith("/tmp/dictation-1.wav"),
    );

    await dictate(state);
    await settle(state);
    expect(state.onJobFinished).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rawText: "안녕하세요, world.",
        finalText: "안녕하세요, world.",
        inserted: true,
        audioPath: "/tmp/dictation-2.wav",
        error: null,
      }),
    );
  });

  it("leaves a recording history took alone, and still removes one when history fails without breaking the queue", async () => {
    const state = setup();
    state.onJobFinished
      .mockResolvedValueOnce({ claimedAudio: true })
      .mockRejectedValueOnce(new Error("database is locked"));
    await dictate(state);
    await dictate(state);
    await dictate(state);
    await settle(state);
    expect(state.insert).toHaveBeenCalledTimes(3);
    expect(state.discard.mock.calls).toEqual([
      ["/tmp/dictation-2.wav"],
      ["/tmp/dictation-3.wav"],
    ]);
    expect(state.onError).toHaveBeenCalledOnce();
  });

  it("caps hands-free recording at five minutes", async () => {
    vi.useFakeTimers();
    const state = setup(true);
    state.controller.press();
    await settle(state, "recording");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(state.stop).toHaveBeenCalledOnce();
    expect(state.insert).toHaveBeenCalledOnce();
  });

  it.each([
    ["hold", false],
    ["hands-free", true],
  ])(
    "in %s mode, starts a new dictation while the last one transcribes and inserts both in the order they were made",
    async (_mode, handsFree) => {
      const state = setup(handsFree);
      const first = gate<ReturnType<typeof said>>();
      state.transcribe
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce(said("Second."));
      state.start
        .mockResolvedValueOnce("first-capture")
        .mockResolvedValueOnce("second-capture");
      await dictate(state);
      await vi.waitFor(() => expect(state.transcribe).toHaveBeenCalled());
      state.controller.press();
      await settle(state, "recording");
      expect(status(state)).toEqual({
        phase: "recording",
        capturing: true,
        pending: 1,
      });
      first.open(said("First."));
      await new Promise((resolve) => setTimeout(resolve));
      // The earlier text waits for the capture in progress to end.
      expect(state.insert).not.toHaveBeenCalled();
      if (handsFree) state.controller.press();
      else state.controller.release();
      await settle(state);
      expect(state.insert.mock.calls).toEqual([["First."], ["Second."]]);
      expect(
        state.onJobFinished.mock.calls.map(([job]) => [
          job.context,
          job.finalText,
        ]),
      ).toEqual([
        ["first-capture", "First."],
        ["second-capture", "Second."],
      ]);
      expect(state.onError).not.toHaveBeenCalled();
    },
  );

  it("escape cancels only the capture in progress, never a dictation already accepted", async () => {
    const state = setup();
    const first = gate<ReturnType<typeof said>>();
    state.transcribe.mockReturnValueOnce(first.promise);
    await dictate(state);
    await vi.waitFor(() => expect(state.transcribe).toHaveBeenCalled());
    state.controller.press();
    await settle(state, "recording");
    await state.controller.cancelCapture();
    expect(state.cancel).toHaveBeenCalledOnce();
    expect(status(state)).toEqual({
      phase: "transcribing",
      capturing: false,
      pending: 1,
    });
    first.open(said("Five minutes of thought."));
    await settle(state);
    expect(state.insert).toHaveBeenCalledWith("Five minutes of thought.");
    expect(state.onStatus.mock.lastCall?.[1]).toBe("completed");
  });

  it("carries on with the next dictation after one fails", async () => {
    const state = setup();
    let fail!: (error: Error) => void;
    state.transcribe
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
      )
      .mockResolvedValueOnce(said("Second."));
    await dictate(state);
    await dictate(state);
    fail(new Error("Network unavailable"));
    await settle(state);
    expect(state.onError).toHaveBeenCalledOnce();
    expect(state.insert.mock.calls).toEqual([["Second."]]);
    expect(state.discard).toHaveBeenCalledTimes(2);
  });

  it("refuses a sixth pending dictation before opening the microphone, leaving the others intact", async () => {
    const state = setup();
    const backlog = gate<void>();
    state.transcribe.mockImplementation(async () => {
      await backlog.promise;
      return said("Queued.");
    });
    for (let count = 0; count < 5; count++) await dictate(state);
    expect(status(state)?.pending).toBe(5);
    state.controller.press();
    expect(state.start).toHaveBeenCalledTimes(5);
    expect(state.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/try again/iu),
      }),
    );
    backlog.open();
    await settle(state);
    expect(state.insert).toHaveBeenCalledTimes(5);
  });
});
