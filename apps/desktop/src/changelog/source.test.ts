import { describe, expect, it } from "vitest";

import { loadBundledChangelog } from "./source";

describe("bundled changelog", () => {
  it("reads release notes from the bundled changelog package", async () => {
    await expect(loadBundledChangelog("0.1.0-beta.1")).resolves.toContain(
      "date:",
    );
  });

  it("returns nothing for unknown versions and path injection", async () => {
    for (const version of [
      "../../main",
      "0.1.0-beta.999",
      "1.4.24?query=1",
      "",
    ]) {
      await expect(loadBundledChangelog(version)).resolves.toBeNull();
    }
  });
});
