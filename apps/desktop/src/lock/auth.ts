import { t } from "@lingui/core/macro";

import { commands } from "@anlg/plugin-local-auth";

export const DEVICE_AUTH_REASON = {
  openApp: "open",
  lockNote: "lock this note",
  unlockNote: "unlock this note",
  changeLockSettings: "change lock settings",
} as const;

// The OS completes the sentence ("Librelog is trying to …"), so only the
// reason fragment is translated.
function localizeAuthReason(reason: string): string {
  switch (reason) {
    case DEVICE_AUTH_REASON.openApp:
      return t({ message: "open", context: "device authentication reason" });
    case DEVICE_AUTH_REASON.lockNote:
      return t`lock this note`;
    case DEVICE_AUTH_REASON.unlockNote:
      return t`unlock this note`;
    case DEVICE_AUTH_REASON.changeLockSettings:
      return t`change lock settings`;
    default:
      return reason;
  }
}

export async function isDeviceAuthAvailable(): Promise<boolean> {
  const result = await commands.available();
  return result.status === "ok" && result.data;
}

export async function authenticateDevice(reason: string): Promise<boolean> {
  const result = await commands.authenticate(localizeAuthReason(reason));
  return result.status === "ok" && result.data === true;
}
