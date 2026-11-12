import { create } from "zustand";

import type { LlmModel } from "@anlg/plugin-local-llm";

// A built-in model the user chose to download; it becomes the Intelligence
// model when the download finishes.
export const usePendingLlmSelection = create<{
  model: LlmModel | null;
  failedDownloads: Partial<Record<LlmModel, string>>;
}>()(() => ({ model: null, failedDownloads: {} }));
