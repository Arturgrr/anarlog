import { create } from "zustand";

import type { DictationPhase } from "./controller";

export const useDictationStatus = create<{
  capturingShortcut: boolean;
  phase: DictationPhase;
  error: string | null;
  lastTranscript: string;
  ready: boolean;
  retry: number;
  cancel: (() => void) | null;
}>(() => ({
  capturingShortcut: false,
  phase: "idle",
  error: null,
  lastTranscript: "",
  ready: false,
  retry: 0,
  cancel: null,
}));
