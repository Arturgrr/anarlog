import { describe, expect, it } from "vitest";

import {
  hasDarkAppIconVariant,
  normalizeAppIconPreference,
  resolveAppIconName,
  resolveDockIconName,
} from "./icon";

describe("app icon preference", () => {
  it("falls back to the default icon for unknown values", () => {
    expect(normalizeAppIconPreference(undefined)).toBe("default");
    expect(normalizeAppIconPreference("unknown")).toBe("default");
    expect(normalizeAppIconPreference("dev")).toBe("dev");
    expect(normalizeAppIconPreference("staging")).toBe("staging");
    expect(normalizeAppIconPreference("journal")).toBe("journal");
    expect(normalizeAppIconPreference("notepad")).toBe("notepad");
    expect(normalizeAppIconPreference("stone")).toBe("stone");
    expect(normalizeAppIconPreference("typewriter-key")).toBe("typewriter-key");
    expect(normalizeAppIconPreference("walnut")).toBe("walnut");
  });

  it("resolves the default icon from the app channel", () => {
    expect(resolveAppIconName("default", "com.arturgrr.librelog")).toBe(
      "stable",
    );
    expect(resolveAppIconName("default", "com.arturgrr.librelog.nightly")).toBe(
      "staging",
    );
    expect(resolveAppIconName("default", "com.arturgrr.librelog.staging")).toBe(
      "staging",
    );
    expect(resolveAppIconName("default", "com.arturgrr.librelog.dev")).toBe(
      "dev",
    );
  });

  it("follows the system appearance for the system theme", () => {
    expect(
      resolveDockIconName(
        "anagram",
        "system",
        false,
        "com.arturgrr.librelog.dev",
      ),
    ).toBe("anagram");
    expect(
      resolveDockIconName(
        "anagram",
        "system",
        true,
        "com.arturgrr.librelog.dev",
      ),
    ).toBe("anagram-dark");
    expect(
      resolveDockIconName("staging", "system", true, "com.arturgrr.librelog"),
    ).toBe("staging-dark");
  });

  it("overrides the system appearance with an explicit theme", () => {
    expect(
      resolveDockIconName(
        "anagram",
        "dark",
        false,
        "com.arturgrr.librelog.dev",
      ),
    ).toBe("anagram-dark");
    expect(
      resolveDockIconName(
        "anagram",
        "light",
        true,
        "com.arturgrr.librelog.dev",
      ),
    ).toBe("anagram");
    expect(
      resolveDockIconName("default", "dark", false, "com.arturgrr.librelog"),
    ).toBe("stable-dark");
  });

  it("keeps theme-independent icons unchanged", () => {
    expect(
      resolveDockIconName("journal", "system", true, "com.arturgrr.librelog"),
    ).toBe("journal");
    expect(
      resolveDockIconName("stone", "dark", false, "com.arturgrr.librelog"),
    ).toBe("stone");
    expect(hasDarkAppIconVariant("anagram")).toBe(true);
    expect(hasDarkAppIconVariant("walnut")).toBe(false);
  });
});
