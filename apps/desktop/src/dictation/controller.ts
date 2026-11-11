import { t } from "@lingui/core/macro";

export type DictationPhase = "idle" | "starting" | "recording" | "transcribing";

const MAX_PENDING_JOBS = 5;
const MAX_CAPTURE_MS = 300_000;

/** A transcript and what made it. */
type Transcript = {
  text: string;
  provider: string | null;
  model: string | null;
  language: string | null;
};

type Recording = {
  filePath: string;
  durationMs: number;
  /** The live preview's final transcript, when it has one. */
  transcript?: Transcript | null;
};

type Capture<Context> = {
  abort: AbortController;
  createdAt: string;
  /** What `start` resolved, once the microphone is open. */
  opened: { context: Context } | null;
  released: boolean;
  timer?: ReturnType<typeof setTimeout>;
  operation: Promise<void>;
  ended: Promise<void>;
  end: () => void;
};

type Job<Context> = {
  id: string;
  createdAt: string;
  context: Context;
  abort: AbortController;
  recording: Promise<Recording>;
};

/**
 * One capture at a time feeds a FIFO of accepted jobs, each transcribed and
 * inserted in the order it was made. Neither starting nor cancelling a
 * capture touches the jobs already accepted.
 */
export class DictationController<Context> {
  private capture: Capture<Context> | null = null;
  private jobs: Job<Context>[] = [];
  private queue: Promise<void> = Promise.resolve();
  private outcome: "completed" | "failed" | "cancelled" = "failed";

  constructor(
    private readonly dependencies: {
      /** Opens the microphone; resolves what its job carries to `onJobFinished`. */
      start: (signal: AbortSignal) => Promise<Context>;
      stop: () => Promise<Recording>;
      cancel: () => Promise<void>;
      transcribe: (path: string, signal: AbortSignal) => Promise<Transcript>;
      insert: (text: string) => Promise<void>;
      discard: (path: string) => Promise<void>;
      /**
       * Once per accepted job, before its recording is discarded. Resolves
       * whether it took the recording file, which is then left alone.
       */
      onJobFinished: (job: {
        id: string;
        createdAt: string;
        durationMs: number;
        context: Context;
        provider: string | null;
        model: string | null;
        language: string | null;
        rawText: string;
        finalText: string;
        inserted: boolean;
        cancelled: boolean;
        audioPath: string | null;
        error: string | null;
      }) => Promise<{ claimedAudio: boolean }>;
      onStatus: (
        status: {
          phase: DictationPhase;
          capturing: boolean;
          pending: number;
        },
        outcome: "completed" | "failed" | "cancelled",
      ) => void;
      onTranscript: (text: string) => void;
      onError: (error: unknown) => void;
      handsFree: boolean;
    },
  ) {}

  press() {
    if (this.capture) {
      if (this.dependencies.handsFree) this.stopCapture(this.capture);
      return;
    }
    if (this.jobs.length >= MAX_PENDING_JOBS) {
      this.dependencies.onError(
        new Error(
          t`Too many dictations are waiting to be transcribed. Try again when one finishes.`,
        ),
      );
      return;
    }
    let end!: () => void;
    const ended = new Promise<void>((resolve) => {
      end = resolve;
    });
    const capture: Capture<Context> = {
      abort: new AbortController(),
      createdAt: new Date().toISOString(),
      opened: null,
      released: false,
      operation: Promise.resolve(),
      ended,
      end,
    };
    this.capture = capture;
    this.emit();
    capture.operation = this.start(capture);
  }

  release(force = false) {
    if (this.capture && (force || !this.dependencies.handsFree)) {
      this.stopCapture(this.capture);
    }
  }

  /** Cancels the capture in progress; accepted jobs carry on. */
  cancelCapture() {
    const capture = this.capture;
    if (!capture) return Promise.resolve();
    if (!capture.abort.signal.aborted) {
      capture.abort.abort();
      clearTimeout(capture.timer);
      this.outcome = "cancelled";
      // A starting capture cancels itself once the microphone has opened.
      if (capture.opened) {
        capture.operation = this.dependencies
          .cancel()
          .catch(this.dependencies.onError)
          .finally(() => this.endCapture(capture));
      }
    }
    return capture.operation;
  }

  /** Cancels the capture in progress and every accepted job. */
  async cancel() {
    for (const job of this.jobs) job.abort.abort();
    await this.cancelCapture();
    await this.queue;
  }

  private emit() {
    const capture = this.capture;
    this.dependencies.onStatus(
      {
        phase: capture
          ? capture.opened
            ? "recording"
            : "starting"
          : this.jobs.length
            ? "transcribing"
            : "idle",
        capturing: capture !== null,
        pending: this.jobs.length,
      },
      this.outcome,
    );
  }

  private endCapture(capture: Capture<Context>) {
    clearTimeout(capture.timer);
    capture.end();
    if (this.capture !== capture) return;
    this.capture = null;
    this.emit();
  }

  private stopCapture(capture: Capture<Context>) {
    if (this.capture !== capture || capture.abort.signal.aborted) return;
    if (capture.opened) this.accept(capture, capture.opened.context);
    else capture.released = true;
  }

  private async start(capture: Capture<Context>) {
    let context: Context;
    try {
      context = await this.dependencies.start(capture.abort.signal);
    } catch (error) {
      // A rejected start never owns the recorder (chat may already be using it).
      if (!capture.abort.signal.aborted) {
        this.outcome = "failed";
        this.dependencies.onError(error);
      }
      this.endCapture(capture);
      return;
    }
    if (capture.abort.signal.aborted) {
      await this.dependencies.cancel().catch(this.dependencies.onError);
      this.endCapture(capture);
      return;
    }
    capture.opened = { context };
    capture.timer = setTimeout(() => this.stopCapture(capture), MAX_CAPTURE_MS);
    this.emit();
    if (capture.released) this.accept(capture, context);
  }

  private accept(capture: Capture<Context>, context: Context) {
    const recording = this.dependencies.stop();
    recording.catch(() => {});
    const job: Job<Context> = {
      id: crypto.randomUUID(),
      createdAt: capture.createdAt,
      context,
      abort: new AbortController(),
      recording,
    };
    this.jobs.push(job);
    this.endCapture(capture);
    this.queue = this.queue.then(() => this.process(job));
  }

  private async process(job: Job<Context>) {
    const { signal } = job.abort;
    let audioPath: string | null = null;
    let durationMs = 0;
    let transcript: Transcript | null = null;
    let inserted = false;
    let error: string | null = null;
    try {
      const recorded = await job.recording;
      audioPath = recorded.filePath;
      durationMs = recorded.durationMs;
      signal.throwIfAborted();
      const made =
        recorded.transcript ??
        (await this.dependencies.transcribe(recorded.filePath, signal));
      transcript = { ...made, text: made.text.trim() };
      signal.throwIfAborted();
      if (!transcript.text) {
        throw new Error(t`No speech detected. Please try again.`);
      }
      // Pasting while a capture is held would type through its shortcut keys
      // or end it, so the text waits for the capture to finish.
      while (this.capture) await this.capture.ended;
      signal.throwIfAborted();
      this.dependencies.onTranscript(transcript.text);
      await this.dependencies.insert(transcript.text);
      inserted = true;
    } catch (caught) {
      if (signal.aborted) {
        error = t`Dictation cancelled.`;
      } else {
        error = caught instanceof Error ? caught.message : String(caught);
        this.dependencies.onError(caught);
      }
    }
    this.outcome = inserted
      ? "completed"
      : signal.aborted
        ? "cancelled"
        : "failed";
    let claimedAudio = false;
    try {
      ({ claimedAudio } = await this.dependencies.onJobFinished({
        id: job.id,
        createdAt: job.createdAt,
        durationMs,
        context: job.context,
        provider: transcript?.provider ?? null,
        model: transcript?.model ?? null,
        language: transcript?.language ?? null,
        rawText: transcript?.text ?? "",
        finalText: transcript?.text ?? "",
        inserted,
        cancelled: this.outcome === "cancelled",
        audioPath,
        error,
      }));
    } catch (caught) {
      this.dependencies.onError(caught);
    }
    if (audioPath && !claimedAudio) {
      await this.dependencies
        .discard(audioPath)
        .catch(this.dependencies.onError);
    }
    this.jobs.splice(this.jobs.indexOf(job), 1);
    this.emit();
  }
}
