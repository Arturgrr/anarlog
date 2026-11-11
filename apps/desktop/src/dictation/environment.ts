import { SETTING_DEFINITIONS } from "~/settings/schema";

export const DICTATION_AUDIO_BEHAVIORS = [
  "nothing",
  "mute",
  "duck",
  "pause",
] as const;

export type DictationAudioBehavior = (typeof DICTATION_AUDIO_BEHAVIORS)[number];

// The `recording-environment` crate's `Config`, as its serde attributes
// spell it.
export type RecordingEnvironmentConfig = {
  behavior:
    | { type: "nothing" }
    | { type: "mute" }
    | { type: "duck"; volume: number }
    | { type: "pauseMedia"; browsers: boolean };
  preventSleep: boolean;
};

export function normalizeDictationAudioBehavior(
  value: string,
): DictationAudioBehavior {
  return (
    DICTATION_AUDIO_BEHAVIORS.find((behavior) => behavior === value) ??
    "nothing"
  );
}

export function normalizeDuckVolume(percent: number): number {
  return Number.isFinite(percent)
    ? Math.round(Math.min(100, Math.max(0, percent)))
    : SETTING_DEFINITIONS.dictation_audio_duck_volume.default;
}

export function recordingEnvironmentConfig({
  behavior,
  duckVolume,
  pauseBrowser,
}: {
  behavior: string;
  duckVolume: number;
  pauseBrowser: boolean;
}): RecordingEnvironmentConfig {
  const preventSleep = true;
  switch (normalizeDictationAudioBehavior(behavior)) {
    case "mute":
      return { behavior: { type: "mute" }, preventSleep };
    case "duck":
      return {
        behavior: {
          type: "duck",
          volume: normalizeDuckVolume(duckVolume) / 100,
        },
        preventSleep,
      };
    case "pause":
      return {
        behavior: { type: "pauseMedia", browsers: pauseBrowser },
        preventSleep,
      };
    case "nothing":
      return { behavior: { type: "nothing" }, preventSleep };
  }
}
