export type AppIconPreference = "default" | "graphite" | "light";

/** Values from removed icon variants fall back to the default icon. */
export function normalizeAppIconPreference(
  value: string | null | undefined,
): AppIconPreference {
  switch (value) {
    case "graphite":
    case "light":
      return value;
    default:
      return "default";
  }
}

export function resolveAppIconName(
  icon: AppIconPreference,
): Exclude<AppIconPreference, "default"> {
  return icon === "default" ? "graphite" : icon;
}
