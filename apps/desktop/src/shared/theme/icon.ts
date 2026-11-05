export type AppIconPreference = "default" | "graphite" | "light";

/** Values from removed icon variants fall back to the channel default. */
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

/** Dev builds default to the light icon so they stay distinguishable in the Dock. */
export function resolveAppIconName(
  icon: AppIconPreference,
  appIdentifier: string,
): Exclude<AppIconPreference, "default"> {
  if (icon !== "default") {
    return icon;
  }
  return appIdentifier.endsWith(".dev") ? "light" : "graphite";
}
