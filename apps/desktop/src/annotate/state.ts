import { create } from "zustand";

import type { AnnotatePhase } from "./flow";

export const useAnnotateStatus = create<{
  phase: AnnotatePhase;
  /** The shortcuts could not be registered. */
  error: string | null;
}>(() => ({ phase: "idle", error: null }));

/**
 * Annotate runs while it is on, and after it is turned off until the session
 * is idle: turning it off never throws a recording away, and its shortcuts
 * stay to finish it.
 */
export function annotateRuns(enabled: boolean, phase: AnnotatePhase) {
  return enabled || phase !== "idle";
}
