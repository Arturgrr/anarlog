import { create } from "zustand";

import type { DictationPhase } from "./controller";

export const useDictationStatus = create<{
  capturingShortcut: boolean;
  /** A capture's phase while one is in progress, else `transcribing` while jobs are pending. */
  phase: DictationPhase;
  /** A capture is starting or recording. */
  capturing: boolean;
  /** Accepted dictations not yet finished. */
  pending: number;
  error: string | null;
  lastTranscript: string;
  ready: boolean;
  retry: number;
  /** Cancels the capture in progress and every pending dictation. */
  cancel: (() => void) | null;
}>(() => ({
  capturingShortcut: false,
  phase: "idle",
  capturing: false,
  pending: 0,
  error: null,
  lastTranscript: "",
  ready: false,
  retry: 0,
  cancel: null,
}));
