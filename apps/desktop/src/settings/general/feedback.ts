// Keep in sync with plugins/tray/src/feedback.rs and the field ids in
// .github/ISSUE_TEMPLATE.
const NEW_ISSUE_URL = "https://github.com/Arturgrr/librelog/issues/new";

export function isBetaVersion(version: string) {
  return version.includes("-beta.");
}

// Pre-fills only the app version, macOS version, and chip. Nothing is sent
// until the user submits the form on GitHub.
export function issueFormUrl(
  template: "bug_report.yml" | "feedback.yml",
  device: { appVersion: string; osVersion: string; arch: string },
) {
  const url = new URL(NEW_ISSUE_URL);
  url.searchParams.set("template", template);
  url.searchParams.set("version", device.appVersion);
  url.searchParams.set("macos", device.osVersion);
  url.searchParams.set(
    "chip",
    device.arch === "aarch64"
      ? "Apple silicon (arm64 build)"
      : device.arch === "x86_64"
        ? "Intel (x86_64 build)"
        : `${device.arch} build`,
  );
  return url.toString();
}
