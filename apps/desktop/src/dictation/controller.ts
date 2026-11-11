import { t } from "@lingui/core/macro";

export type DictationPhase = "idle" | "starting" | "recording" | "transcribing";

const MAX_PENDING_JOBS = 5;
const MAX_CAPTURE_MS = 300_000;

type Capture = {
  phase: "starting" | "recording";
  abort: AbortController;
  createdAt: string;
  target: string;
  released: boolean;
  timer?: ReturnType<typeof setTimeout>;
  operation: Promise<void>;
  ended: Promise<void>;
  end: () => void;
};

type Job = {
  id: string;
  createdAt: string;
  target: string;
  abort: AbortController;
  recording: Promise<{
    filePath: string;
    durationMs: number;
    transcript?: string | null;
  }>;
};

/**
 * One capture at a time feeds a FIFO of accepted jobs, each transcribed and
 * inserted in the order it was made. Neither starting nor cancelling a
 * capture touches the jobs already accepted.
 */
export class DictationController {
  private capture: Capture | null = null;
  private jobs: Job[] = [];
  private queue: Promise<void> = Promise.resolve();
  private outcome: "completed" | "failed" | "cancelled" = "failed";

  constructor(
    private readonly dependencies: {
      start: (signal: AbortSignal) => Promise<string>;
      stop: () => Promise<{
        filePath: string;
        durationMs: number;
        transcript?: string | null;
      }>;
      cancel: () => Promise<void>;
      transcribe: (path: string, signal: AbortSignal) => Promise<string>;
      insert: (target: string, text: string) => Promise<void>;
      discard: (path: string) => Promise<void>;
      onJobFinished: (job: {
        id: string;
        createdAt: string;
        durationMs: number;
        target: string;
        rawText: string;
        finalText: string;
        inserted: boolean;
        audioPath: string | null;
        error: string | null;
      }) => Promise<void> | void;
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
    const capture: Capture = {
      phase: "starting",
      abort: new AbortController(),
      createdAt: new Date().toISOString(),
      target: "",
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
      if (capture.phase === "recording") {
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
    this.dependencies.onStatus(
      {
        phase:
          this.capture?.phase ?? (this.jobs.length ? "transcribing" : "idle"),
        capturing: this.capture !== null,
        pending: this.jobs.length,
      },
      this.outcome,
    );
  }

  private endCapture(capture: Capture) {
    clearTimeout(capture.timer);
    capture.end();
    if (this.capture !== capture) return;
    this.capture = null;
    this.emit();
  }

  private stopCapture(capture: Capture) {
    if (this.capture !== capture || capture.abort.signal.aborted) return;
    if (capture.phase === "starting") capture.released = true;
    else this.accept(capture);
  }

  private async start(capture: Capture) {
    try {
      capture.target = await this.dependencies.start(capture.abort.signal);
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
    capture.phase = "recording";
    capture.timer = setTimeout(() => this.stopCapture(capture), MAX_CAPTURE_MS);
    this.emit();
    if (capture.released) this.accept(capture);
  }

  private accept(capture: Capture) {
    const recording = this.dependencies.stop();
    recording.catch(() => {});
    const job: Job = {
      id: crypto.randomUUID(),
      createdAt: capture.createdAt,
      target: capture.target,
      abort: new AbortController(),
      recording,
    };
    this.jobs.push(job);
    this.endCapture(capture);
    this.queue = this.queue.then(() => this.process(job));
  }

  private async process(job: Job) {
    const { signal } = job.abort;
    let audioPath: string | null = null;
    let durationMs = 0;
    let rawText = "";
    let finalText = "";
    let inserted = false;
    let error: string | null = null;
    try {
      const recorded = await job.recording;
      audioPath = recorded.filePath;
      durationMs = recorded.durationMs;
      signal.throwIfAborted();
      rawText = (
        recorded.transcript ??
        (await this.dependencies.transcribe(recorded.filePath, signal))
      ).trim();
      signal.throwIfAborted();
      finalText = rawText;
      if (!finalText) throw new Error(t`No speech detected. Please try again.`);
      // Pasting while a capture is held would type through its shortcut keys
      // or end it, so the text waits for the capture to finish.
      while (this.capture) await this.capture.ended;
      signal.throwIfAborted();
      this.dependencies.onTranscript(finalText);
      await this.dependencies.insert(job.target, finalText);
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
    try {
      await this.dependencies.onJobFinished({
        id: job.id,
        createdAt: job.createdAt,
        durationMs,
        target: job.target,
        rawText,
        finalText,
        inserted,
        audioPath,
        error,
      });
    } catch (caught) {
      this.dependencies.onError(caught);
    }
    if (audioPath) {
      await this.dependencies
        .discard(audioPath)
        .catch(this.dependencies.onError);
    }
    this.jobs.splice(this.jobs.indexOf(job), 1);
    this.emit();
  }
}
