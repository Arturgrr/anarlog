import { describe, expect, it } from "vitest";

import { normalizeAppIconPreference, resolveAppIconName } from "./icon";

describe("app icon preference", () => {
  it("falls back to the default icon for unknown and removed values", () => {
    expect(normalizeAppIconPreference(undefined)).toBe("default");
    expect(normalizeAppIconPreference("unknown")).toBe("default");
    expect(normalizeAppIconPreference("anagram")).toBe("default");
    expect(normalizeAppIconPreference("walnut")).toBe("default");
    expect(normalizeAppIconPreference("graphite")).toBe("graphite");
    expect(normalizeAppIconPreference("light")).toBe("light");
  });

  it("resolves the default icon from the app channel", () => {
    expect(resolveAppIconName("default", "com.hyprnote.stable")).toBe(
      "graphite",
    );
    expect(resolveAppIconName("default", "com.hyprnote.nightly")).toBe(
      "graphite",
    );
    expect(resolveAppIconName("default", "com.hyprnote.staging")).toBe(
      "graphite",
    );
    expect(resolveAppIconName("default", "com.hyprnote.dev")).toBe("light");
    expect(resolveAppIconName("graphite", "com.hyprnote.dev")).toBe("graphite");
  });
});
