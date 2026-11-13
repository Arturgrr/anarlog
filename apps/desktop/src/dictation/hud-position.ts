import type { HudPosition } from "@anlg/plugin-dictation";

const HUD_POSITIONS = ["top", "bottom", "hidden", "notch"] as const;

/** The notch indicator is drawn by the macOS HUD alone. */
export function hudPositions(os: string): readonly HudPosition[] {
  return os === "macos"
    ? HUD_POSITIONS
    : HUD_POSITIONS.filter((position) => position !== "notch");
}

export function normalizeHudPosition(value: string, os: string): HudPosition {
  return hudPositions(os).find((position) => position === value) ?? "top";
}
