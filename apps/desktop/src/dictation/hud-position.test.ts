import { describe, expect, it } from "vitest";

import { normalizeHudPosition } from "./hud-position";

describe("normalizeHudPosition", () => {
  it("keeps the notch to macOS and repairs values the HUD would misread", () => {
    for (const position of ["top", "bottom", "hidden", "notch"])
      expect(normalizeHudPosition(position, "macos")).toBe(position);
    expect(normalizeHudPosition("notch", "windows")).toBe("top");
    expect(normalizeHudPosition("notch", "linux")).toBe("top");
    expect(normalizeHudPosition("hidden", "linux")).toBe("hidden");
    expect(normalizeHudPosition("", "macos")).toBe("top");
    expect(normalizeHudPosition("left", "windows")).toBe("top");
  });
});
