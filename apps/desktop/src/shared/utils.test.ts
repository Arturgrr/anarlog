import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getIdentifier: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getIdentifier: mocks.getIdentifier,
}));

import { getScheme } from "./utils";

describe("getScheme", () => {
  beforeEach(() => {
    mocks.getIdentifier.mockReset();
  });

  it.each([
    ["com.arturgrr.librelog", "librelog"],
    ["com.arturgrr.librelog.staging", "librelog-staging"],
    ["com.arturgrr.librelog.nightly", "librelog-nightly"],
    ["com.arturgrr.librelog.dev", "librelog-dev"],
    ["io.github.arturgrr.Librelog", "librelog"],
    ["com.arturgrr.librelog", "librelog"],
    ["unknown", "librelog"],
  ])("maps %s to %s", async (identifier, scheme) => {
    mocks.getIdentifier.mockResolvedValue(identifier);

    await expect(getScheme()).resolves.toBe(scheme);
  });
});
