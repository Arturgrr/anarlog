import { invoke } from "@tauri-apps/api/core";

import type { Result, SttModelInfo } from "@anlg/plugin-local-stt";

// The GGUF engine's commands and catalog fields, declared here until the
// local-stt bindings are regenerated with them. Callers depend only on this
// module, so the regenerated bindings replace its declarations and command
// bodies without touching them.

export type SttDevicePreference = "auto" | "gpu" | "cpu";

export type SttDevice = {
  id: string;
  name: string;
  kind: "gpu" | "cpu";
  backend: string;
  failed: boolean;
};

export type SttModelLicense = {
  spdx: string | null;
  name: string;
  url: string;
  attribution: string | null;
};

export type SttModelTimestamps = "word" | "segment" | "none";

export type SttCatalogModel = Omit<SttModelInfo, "model_type"> & {
  model_type: SttModelInfo["model_type"] | "gguf";
  languages?: string[] | null;
  license?: SttModelLicense | null;
  timestamps?: SttModelTimestamps | null;
};

export function asSttCatalogModels(models: SttModelInfo[]): SttCatalogModel[] {
  return models;
}

async function invokeLocalStt<T>(command: string): Promise<Result<T, string>> {
  try {
    return {
      status: "ok",
      data: await invoke<T>(`plugin:local-stt|${command}`),
    };
  } catch (error) {
    if (error instanceof Error) throw error;
    return { status: "error", error: error as string };
  }
}

export const ggufCommands = {
  listSttDevices: () => invokeLocalStt<SttDevice[]>("list_stt_devices"),
  forgetSttGpuFailures: () => invokeLocalStt<null>("forget_stt_gpu_failures"),
};
