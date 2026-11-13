import { create } from "zustand";

import type { AnnotatePhase } from "./flow";

export const useAnnotateStatus = create<{
  phase: AnnotatePhase;
  /** The shortcuts could not be registered. */
  error: string | null;
}>(() => ({ phase: "idle", error: null }));
