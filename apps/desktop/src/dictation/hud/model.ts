// The HUD's lifecycle, ported from Hex's `src/dictation/indicator.rs` (MIT,
// © 2026 Christopher Langton) for one dictation at a time: the phase
// bookkeeping and how long each look shows, driving Dot scope. Time is passed
// in, never read. The macOS HUD keeps the same model in Swift
// (`crates/dictation-ui-macos`).

import type { HudEvent } from "@anlg/plugin-dictation";

import { loudness, Scope, type Stage } from "./scope";

/** The loudness before any meter arrives, dBFS. */
const SILENT = -120;
/**
 * The shortest processing look: a fast transcription still shows the field
 * turning blue before done clears it.
 */
const PROCESSING_MINIMUM = 0.2;
/**
 * How long done shows before the HUD collapses: a third into done's 0.3 s
 * wipe, so the collapse and the wipe end together.
 */
const COMPLETED_VISIBLE = 0.1;
const FAILED_VISIBLE = 0.6;

type Phase =
  | "hidden"
  | "recording"
  | "transcribing"
  | "completed"
  | "cancelled"
  | "failed";

export class HudModel {
  readonly scope = new Scope();
  private phase: Phase = "hidden";
  private phaseStarted = 0;
  private workingSince = 0;
  private completionPending = false;
  private stage: Stage = "recording";
  private loudness = SILENT;
  /** Since an event, until a step finds everything settled out of sight. */
  active = false;

  /** Whether the microphone is still recorded, which is when live text shows. */
  get recording() {
    return this.phase === "recording";
  }

  handle(event: HudEvent, now: number, reduceMotion: boolean) {
    this.active = true;
    switch (event.type) {
      case "started":
        this.phase = "recording";
        this.phaseStarted = now;
        this.completionPending = false;
        this.loudness = SILENT;
        this.stage = "recording";
        this.scope.restart(reduceMotion);
        break;
      case "processing":
        if (this.phase !== "transcribing") this.workingSince = now;
        this.phase = "transcribing";
        this.phaseStarted = now;
        this.completionPending = false;
        break;
      case "completed":
        if (this.phase !== "transcribing") {
          this.phase = "transcribing";
          this.workingSince = now;
        }
        this.completionPending = true;
        break;
      case "failed":
      case "cancelled":
        this.phase = event.type;
        this.phaseStarted = now;
        this.completionPending = false;
        break;
      case "preview":
        break;
    }
  }

  meter(rms: number) {
    this.loudness = loudness(rms);
  }

  /**
   * Advances `dt` seconds to `now`. Once everything has settled out of sight,
   * `active` turns false.
   */
  step(now: number, rawDt: number, reduceMotion: boolean) {
    const dt = Math.min(Math.max(rawDt, 1 / 240), 1 / 20);
    if (
      this.completionPending &&
      now - this.workingSince >= PROCESSING_MINIMUM
    ) {
      this.phase = "completed";
      this.phaseStarted = now;
      this.completionPending = false;
    }
    const shownFor =
      this.phase === "completed"
        ? COMPLETED_VISIBLE
        : this.phase === "cancelled"
          ? 0
          : this.phase === "failed"
            ? FAILED_VISIBLE
            : null;
    const finished = shownFor !== null && now - this.phaseStarted >= shownFor;
    const visible = this.phase !== "hidden" && !finished;
    if (this.phase === "recording") this.stage = "recording";
    else if (this.phase === "transcribing") this.stage = "processing";
    else if (this.phase === "completed") this.stage = "done";
    else if (this.phase === "failed") this.stage = "failed";
    this.scope.advance(dt, {
      stage: this.stage,
      visible,
      loudness: this.loudness,
      reduceMotion,
    });
    this.active = visible || !this.scope.settled();
  }
}
