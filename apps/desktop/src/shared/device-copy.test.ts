import { afterEach, expect, test } from "vitest";

import { deviceCopy } from "./device-copy";

const internals = window as unknown as {
  __TAURI_OS_PLUGIN_INTERNALS__: { platform: string };
};

afterEach(() => {
  internals.__TAURI_OS_PLUGIN_INTERNALS__.platform = "macos";
});

test("says Mac only on macOS", () => {
  expect(deviceCopy.onThisDevice()).toBe("On this Mac");

  internals.__TAURI_OS_PLUGIN_INTERNALS__.platform = "linux";
  expect(deviceCopy.onThisDevice()).toBe("On this computer");
  expect(deviceCopy.runModelSignInOrApiKey()).not.toContain("Mac");
});
