import type { RecordingEnvironment } from "@anlg/plugin-dictation";

import { SETTING_DEFINITIONS } from "~/settings/schema";

export const DICTATION_AUDIO_BEHAVIORS = [
  "nothing",
  "mute",
  "duck",
  "pause",
] as const;

export type DictationAudioBehavior = (typeof DICTATION_AUDIO_BEHAVIORS)[number];

/**
 * The behaviours this build can carry out. The App Store build is sandboxed:
 * it may not script Music, Spotify, or VLC, and it leaves out the private
 * browser pause, so on macOS it cannot pause anything.
 */
export function dictationAudioBehaviors({
  os,
  appStore,
}: {
  os: string;
  appStore: boolean;
}): readonly DictationAudioBehavior[] {
  return os === "macos" && appStore
    ? DICTATION_AUDIO_BEHAVIORS.filter((behavior) => behavior !== "pause")
    : DICTATION_AUDIO_BEHAVIORS;
}

export function normalizeDictationAudioBehavior(
  value: string,
  available: readonly DictationAudioBehavior[] = DICTATION_AUDIO_BEHAVIORS,
): DictationAudioBehavior {
  return available.find((behavior) => behavior === value) ?? "nothing";
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
  available,
}: {
  behavior: string;
  duckVolume: number;
  pauseBrowser: boolean;
  available?: readonly DictationAudioBehavior[];
}): RecordingEnvironment["config"] {
  const preventSleep = true;
  switch (normalizeDictationAudioBehavior(behavior, available)) {
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
