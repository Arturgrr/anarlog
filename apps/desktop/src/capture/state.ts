import { create } from "zustand";

import type { CapturePhase } from "./flow";

export const useCaptureStatus = create<{
  phase: CapturePhase;
  /** Some shortcuts could not be registered. */
  error: string | null;
}>(() => ({ phase: "idle", error: null }));

/**
 * Capture runs while it is on, and after it is turned off until nothing
 * selects, records or finishes: turning it off never strands a recording
 * without the shortcut that stops it.
 */
export function captureRuns(enabled: boolean, phase: CapturePhase) {
  return enabled || phase !== "idle";
}
