import { describe, expect, it, vi } from "vitest";

vi.mock("@anlg/plugin-capture", () => ({ commands: {} }));
vi.mock("@anlg/plugin-opener2", () => ({ commands: {} }));
vi.mock("~/settings/queries", () => ({
  getStoredSettingValues: vi.fn(),
  setSettingValues: vi.fn(),
}));

import {
  createSystemShortcutSwitch,
  type SystemShortcutDeps,
} from "./system-shortcuts";

// The spelling the shortcut parser accepts (it refuses "Meta").
const MAC_SHORTCUTS = {
  capture_shortcut_area: "Super+Shift+Digit4",
  capture_shortcut_fullscreen: "Super+Shift+Digit3",
  capture_shortcut_record: "Super+Shift+Digit5",
  capture_shortcut_gif: "Super+Shift+Digit6",
};

const ON = { area: true, fullscreen: true, options: true, replaced: false };
const OFF = { area: false, fullscreen: false, options: false, replaced: true };
const MINE = {
  capture_shortcut_area: "Alt+Shift+Digit4",
  capture_shortcut_fullscreen: "Alt+Shift+Digit3",
  capture_shortcut_record: "Control+Alt+KeyR",
  capture_shortcut_gif: "Alt+Shift+Digit6",
};

function setup(replaceAnswer = OFF) {
  let stored = {
    ...MINE,
    capture_replace_system_shortcuts: false,
    capture_shortcuts_before_replace: "",
    capture_enabled: true,
  };
  let system = ON;
  const plugin = {
    read: vi.fn(async () => system),
    replace: vi.fn(async () => (system = replaceAnswer)),
    restore: vi.fn(async () => (system = ON)),
  };
  const deps: SystemShortcutDeps = {
    plugin,
    settings: async () => stored,
    save: vi.fn(async (values) => {
      stored = { ...stored, ...values };
    }),
  };
  return {
    toggle: createSystemShortcutSwitch(deps),
    plugin,
    stored: () => stored,
    turnOffByHand: () => (system = OFF),
  };
}

describe("Replacing the macOS screenshot shortcuts", () => {
  it("binds ⌘⇧3/4/5/6 once macOS's are off and remembers the user's own", async () => {
    const { toggle, stored } = setup();
    await toggle.turnOn();
    expect(stored()).toMatchObject({
      ...MAC_SHORTCUTS,
      capture_replace_system_shortcuts: true,
    });
    expect(JSON.parse(stored().capture_shortcuts_before_replace)).toEqual(MINE);
  });

  it("leaves the setting off while one of macOS's is still on, until a check finds them off", async () => {
    const partly = { ...OFF, options: true };
    const { toggle, stored, turnOffByHand } = setup(partly);
    expect(await toggle.turnOn()).toEqual(partly);
    expect(stored()).toMatchObject({
      ...MINE,
      capture_replace_system_shortcuts: false,
    });

    turnOffByHand();
    await toggle.checkAgain();
    expect(stored()).toMatchObject({
      ...MAC_SHORTCUTS,
      capture_replace_system_shortcuts: true,
    });
  });

  it("restores macOS's shortcuts and the user's own when turned off", async () => {
    const { toggle, plugin, stored } = setup();
    await toggle.turnOn();
    await toggle.turnOff();
    expect(plugin.restore).toHaveBeenCalled();
    expect(stored()).toMatchObject({
      ...MINE,
      capture_replace_system_shortcuts: false,
      capture_shortcuts_before_replace: "",
    });
  });

  it("gives macOS's shortcuts back when Capture is turned off while they are replaced", async () => {
    const { toggle, plugin, stored } = setup();
    await toggle.turnOn();
    await toggle.disableCapture();
    expect(plugin.restore).toHaveBeenCalled();
    expect(stored()).toMatchObject({
      ...MINE,
      capture_enabled: false,
      capture_replace_system_shortcuts: false,
    });
  });
});
