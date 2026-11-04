import { describe, expect, it } from "vitest";

import { loadBundledChangelog } from "./source";

describe("bundled changelog", () => {
  it("reads release notes from the bundled changelog package", async () => {
    await expect(loadBundledChangelog("1.0.0")).resolves.toContain("date:");
  });

  it("returns nothing for unknown versions and path injection", async () => {
    for (const version of [
      "../../main",
      "1.4.24-nightly.123",
      "1.4.24?query=1",
      "",
    ]) {
      await expect(loadBundledChangelog(version)).resolves.toBeNull();
    }
  });
});
