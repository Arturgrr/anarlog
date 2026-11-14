import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  commands as capture,
  type SystemShortcuts,
} from "@anlg/plugin-capture";
import { commands as opener } from "@anlg/plugin-opener2";

import { captureAvailable } from "./system";

import { getStoredSettingValues, setSettingValues } from "~/settings/queries";
import { SETTING_DEFINITIONS, type SettingValues } from "~/settings/schema";
import { resolveConfigValues, useConfigValue } from "~/shared/config";

/** Librelog's shortcuts in place of macOS's ⌘⇧4, ⌘⇧3 and ⌘⇧5. */
export const MAC_SHORTCUTS = {
  capture_shortcut_area: "Super+Shift+Digit4",
  capture_shortcut_fullscreen: "Super+Shift+Digit3",
  capture_shortcut_record: "Super+Shift+Digit5",
  capture_shortcut_gif: "Super+Shift+Digit6",
} as const;
type Replaced = keyof typeof MAC_SHORTCUTS;
const REPLACED = Object.keys(MAC_SHORTCUTS) as Replaced[];

export const KEYBOARD_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.Keyboard-Settings.extension";

const SETTING_KEYS = [
  ...REPLACED,
  "capture_replace_system_shortcuts",
  "capture_shortcuts_before_replace",
] as const;
type Current = ReturnType<
  typeof resolveConfigValues<(typeof SETTING_KEYS)[number]>
>;

/** What switching needs from the app; each throws on failure. */
export type SystemShortcutDeps = {
  plugin: {
    read: () => Promise<SystemShortcuts>;
    replace: () => Promise<SystemShortcuts>;
    restore: () => Promise<SystemShortcuts>;
  };
  settings: () => Promise<Current>;
  save: (values: SettingValues) => Promise<void>;
};

/** None of macOS's screenshot shortcuts is on any more. */
export function allOff(status: SystemShortcuts) {
  return !status.area && !status.fullscreen && !status.options;
}

function previousShortcuts(json: string): Record<Replaced, string> {
  let saved: Partial<Record<Replaced, unknown>> = {};
  try {
    saved = JSON.parse(json) ?? {};
  } catch {
    // An unreadable backup falls back to the defaults.
  }
  const result = {} as Record<Replaced, string>;
  for (const key of REPLACED) {
    const value = saved[key];
    result[key] =
      typeof value === "string" ? value : SETTING_DEFINITIONS[key].default;
  }
  return result;
}

export function createSystemShortcutSwitch(deps: SystemShortcutDeps) {
  /** Binds Librelog's shortcuts to macOS's keys, remembering the user's own. */
  async function complete() {
    const current = await deps.settings();
    if (current.capture_replace_system_shortcuts) return;
    const before = Object.fromEntries(
      REPLACED.map((key) => [key, current[key]]),
    );
    await deps.save({
      ...MAC_SHORTCUTS,
      capture_shortcuts_before_replace: JSON.stringify(before),
      capture_replace_system_shortcuts: true,
    });
  }

  /** Turns macOS's shortcuts off; when some stay on, the user turns them off by hand. */
  async function turnOn() {
    const status = await deps.plugin.replace();
    if (allOff(status)) await complete();
    return status;
  }

  /** After the user turned them off in System Settings. */
  async function checkAgain() {
    const status = await deps.plugin.read();
    if (allOff(status)) await complete();
    return status;
  }

  /** Puts macOS's shortcuts and the user's own back. */
  async function turnOff() {
    const status = await deps.plugin.restore();
    const current = await deps.settings();
    if (current.capture_replace_system_shortcuts) {
      await deps.save({
        ...previousShortcuts(current.capture_shortcuts_before_replace),
        capture_shortcuts_before_replace: "",
        capture_replace_system_shortcuts: false,
      });
    }
    return status;
  }

  /**
   * Turning Capture off gives macOS's shortcuts back first, or the Mac would
   * be left without a screenshot shortcut.
   */
  async function disableCapture() {
    const current = await deps.settings();
    if (
      current.capture_replace_system_shortcuts ||
      (await deps.plugin.read()).replaced
    ) {
      await turnOff();
    }
    await deps.save({ capture_enabled: false });
  }

  return { turnOn, checkAgain, turnOff, disableCapture };
}

function unwrap<T>(
  result: { status: "ok"; data: T } | { status: "error"; error: string },
): T {
  if (result.status === "error") throw new Error(result.error);
  return result.data;
}

const appSwitch = createSystemShortcutSwitch({
  plugin: {
    read: async () => unwrap(await capture.systemShortcuts()),
    replace: async () => unwrap(await capture.replaceSystemShortcuts()),
    restore: async () => unwrap(await capture.restoreSystemShortcuts()),
  },
  settings: async () =>
    resolveConfigValues(SETTING_KEYS, await getStoredSettingValues()),
  save: setSettingValues,
});

const QUERY_KEY = ["capture-system-shortcuts"];

/**
 * The "Replace the macOS screenshot shortcuts" switch, shared by the settings
 * page and onboarding.
 */
export function useSystemShortcuts() {
  const client = useQueryClient();
  const replaced = useConfigValue("capture_replace_system_shortcuts");
  const status = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => unwrap(await capture.systemShortcuts()),
    enabled: captureAvailable(),
    refetchOnWindowFocus: true,
  });
  const onStatus = (next: SystemShortcuts) =>
    client.setQueryData(QUERY_KEY, next);
  const change = useMutation({
    mutationFn: (action: "on" | "off" | "check") =>
      action === "on"
        ? appSwitch.turnOn()
        : action === "off"
          ? appSwitch.turnOff()
          : appSwitch.checkAgain(),
    onSuccess: onStatus,
  });
  const disable = useMutation({
    mutationFn: appSwitch.disableCapture,
    onSettled: () => client.invalidateQueries({ queryKey: QUERY_KEY }),
  });
  const openKeyboardSettings = useMutation({
    mutationFn: async () => {
      unwrap(await opener.openUrl(KEYBOARD_SETTINGS_URL, null));
    },
  });

  return {
    replaced,
    status,
    /** Librelog turned some off but macOS still has one on. */
    needsManualStep:
      !replaced && !!status.data?.replaced && !allOff(status.data),
    setReplaced: (on: boolean) => change.mutate(on ? "on" : "off"),
    checkAgain: () => change.mutate("check"),
    disableCapture: () => disable.mutate(),
    openKeyboardSettings: () => openKeyboardSettings.mutate(),
    pending: change.isPending || disable.isPending,
    error: change.error ?? disable.error ?? openKeyboardSettings.error,
  };
}
