import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ platform: "macos" }));

vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => mocks.platform }));

import {
  getInitialStep,
  getOnboardingSteps,
  limitToMissingSelection,
  saveOnboardingStep,
} from "./config";

beforeEach(() => {
  localStorage.clear();
});

it.each([
  ["macos", ["permissions", "transcription", "intelligence", "final"]],
  ["windows", ["transcription", "intelligence", "final"]],
  ["linux", ["transcription", "intelligence", "final"]],
])(
  "sets up transcription and intelligence before finishing on %s",
  (platform, steps) => {
    mocks.platform = platform;
    expect(getOnboardingSteps()).toEqual(steps);
    expect(getInitialStep()).toBe(steps[0]);
  },
);

it("resumes at the saved step after a restart, or at the step whose choice is missing", () => {
  mocks.platform = "macos";
  saveOnboardingStep("transcription");
  expect(getInitialStep()).toBe("transcription");

  saveOnboardingStep("final");
  expect(getInitialStep()).toBe("final");
  expect(limitToMissingSelection("final", null)).toBe("final");
  expect(limitToMissingSelection("final", "transcription")).toBe(
    "transcription",
  );
  expect(limitToMissingSelection("permissions", "transcription")).toBe(
    "permissions",
  );

  mocks.platform = "windows";
  saveOnboardingStep("permissions");
  expect(getInitialStep()).toBe("transcription");

  saveOnboardingStep(null);
  expect(getInitialStep()).toBe("transcription");
});
