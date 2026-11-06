import { platform } from "@tauri-apps/plugin-os";

import type { SectionStatus } from "./shared";

export type OnboardingStep =
  | "permissions"
  | "transcription"
  | "intelligence"
  | "final";

const STEPS_MACOS: OnboardingStep[] = [
  "permissions",
  "transcription",
  "intelligence",
  "final",
];
const STEPS_OTHER: OnboardingStep[] = [
  "transcription",
  "intelligence",
  "final",
];

const SAVED_STEP_KEY = "librelog.onboarding-step";

export function getOnboardingSteps(): OnboardingStep[] {
  return platform() === "macos" ? STEPS_MACOS : STEPS_OTHER;
}

export function getInitialStep(): OnboardingStep {
  const steps = getOnboardingSteps();
  const saved = readSavedStep();
  // A download can stop or a key can change while the app is closed, so a
  // restart on the last step goes back to Intelligence, which checks both
  // models again before letting people finish.
  const resumed = saved === "final" ? "intelligence" : saved;
  return resumed && steps.includes(resumed) ? resumed : steps[0];
}

export function saveOnboardingStep(step: OnboardingStep | null) {
  try {
    if (step) {
      localStorage.setItem(SAVED_STEP_KEY, step);
    } else {
      localStorage.removeItem(SAVED_STEP_KEY);
    }
  } catch (error) {
    console.error("Failed to save the onboarding step", error);
  }
}

function readSavedStep(): OnboardingStep | null {
  try {
    return localStorage.getItem(SAVED_STEP_KEY) as OnboardingStep | null;
  } catch {
    return null;
  }
}

export function getPrevStep(
  currentStep: OnboardingStep,
): OnboardingStep | null {
  const steps = getOnboardingSteps();
  const idx = steps.indexOf(currentStep);
  return idx > 0 ? steps[idx - 1] : null;
}

export function getNextStep(
  currentStep: OnboardingStep,
): OnboardingStep | null {
  const steps = getOnboardingSteps();
  const idx = steps.indexOf(currentStep);
  return idx < steps.length - 1 ? steps[idx + 1] : null;
}

export function getStepStatus(
  step: OnboardingStep,
  currentStep: OnboardingStep,
): SectionStatus | null {
  const steps = getOnboardingSteps();
  const stepIdx = steps.indexOf(step);
  if (stepIdx === -1) return null;
  const currentIdx = steps.indexOf(currentStep);
  if (stepIdx < currentIdx) return "completed";
  if (stepIdx === currentIdx) return "active";
  return "upcoming";
}
