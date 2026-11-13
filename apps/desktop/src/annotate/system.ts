import { platform } from "@tauri-apps/plugin-os";

import { commands as annotate } from "@anlg/plugin-annotate";

import { isAppStoreBuild } from "~/shared/app-store";

/** Annotate records on macOS only, and not in the App Store build. */
export function annotateAvailable() {
  return platform() === "macos" && !isAppStoreBuild();
}

export async function openScreenRecordingSettings() {
  const result = await annotate.openScreenRecordingSettings();
  if (result.status === "error") throw new Error(result.error);
}
