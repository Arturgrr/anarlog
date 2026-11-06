import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ platform: "macos" }));

vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => mocks.platform }));

import {
  getInitialStep,
  getOnboardingSteps,
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

it("resumes at the saved step after a restart without skipping the model checks", () => {
  mocks.platform = "macos";
  saveOnboardingStep("transcription");
  expect(getInitialStep()).toBe("transcription");

  saveOnboardingStep("final");
  expect(getInitialStep()).toBe("intelligence");

  mocks.platform = "windows";
  saveOnboardingStep("permissions");
  expect(getInitialStep()).toBe("transcription");

  saveOnboardingStep(null);
  expect(getInitialStep()).toBe("transcription");
});
