import { platform } from "@tauri-apps/plugin-os";

import { isAppStoreBuild } from "~/shared/app-store";
import { useConfigValue, useConfigValues } from "~/shared/config";

export const CAPTURE_ACTIONS = [
  "area",
  "fullscreen",
  "window",
  "record",
  "gif",
] as const;
export type CaptureAction = (typeof CAPTURE_ACTIONS)[number];

export const CAPTURE_SHORTCUT_KEYS = {
  area: "capture_shortcut_area",
  fullscreen: "capture_shortcut_fullscreen",
  window: "capture_shortcut_window",
  record: "capture_shortcut_record",
  gif: "capture_shortcut_gif",
} as const satisfies Record<CaptureAction, string>;

/** Capture works on macOS only, and not in the App Store build. */
export function captureAvailable() {
  return platform() === "macos" && !isAppStoreBuild();
}

/** Every Capture shortcut by action; empty is unbound. */
export function useCaptureShortcutMap(): Record<CaptureAction, string> {
  const values = useConfigValues(Object.values(CAPTURE_SHORTCUT_KEYS));
  return {
    area: values.capture_shortcut_area,
    fullscreen: values.capture_shortcut_fullscreen,
    window: values.capture_shortcut_window,
    record: values.capture_shortcut_record,
    gif: values.capture_shortcut_gif,
  };
}

/** Capture's bound shortcuts while it is on, which the others must not reuse. */
export function useCaptureShortcuts(): string[] {
  const enabled = useConfigValue("capture_enabled");
  const shortcuts = useCaptureShortcutMap();
  if (!enabled || !captureAvailable()) return [];
  return Object.values(shortcuts).filter(Boolean);
}
