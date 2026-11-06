import { t } from "@lingui/core/macro";
import { platform } from "@tauri-apps/plugin-os";

import {
  commands as permissionsCommands,
  type PermissionStatus,
} from "@anlg/plugin-permissions";
import { toast } from "@anlg/ui/components/ui/toast";

import type { SettingsTab } from "~/store/zustand/tabs/schema";

export type StartFailureStage =
  | "recovery_marker"
  | "capture_start"
  | "capture_rejected";

export type StartFailureKind =
  | "already_running"
  | "storage"
  | "microphone_permission"
  | "recorder";

const START_FAILURE_TOAST_ID = "capture-start-failed";

export function classifyStartFailure({
  stage,
  error,
  microphonePermission,
}: {
  stage: StartFailureStage;
  error: string | null;
  microphonePermission: PermissionStatus | null;
}): StartFailureKind {
  if (stage === "recovery_marker") {
    return "storage";
  }
  if (error?.includes("session already running")) {
    return "already_running";
  }
  if (error?.includes("session storage unavailable")) {
    return "storage";
  }
  if (microphonePermission && microphonePermission !== "authorized") {
    return "microphone_permission";
  }
  return "recorder";
}

export function describeStartFailure(kind: StartFailureKind): {
  title: string;
  description: string;
  action?: { label: string; tab: SettingsTab };
} {
  switch (kind) {
    case "already_running":
      return {
        title: t`Another recording is still running`,
        description: t`Stop the current recording, or wait for it to finish saving, then try again.`,
      };
    case "storage":
      return {
        title: t`Librelog couldn't prepare storage for this recording`,
        description: t`Check that your vault folder is available and your disk has free space, then try again.`,
      };
    case "microphone_permission":
      return {
        title: t`Librelog doesn't have microphone access`,
        description: t`Allow microphone access for Librelog, then try again.`,
        action: { label: t`Open permissions`, tab: "permissions" },
      };
    case "recorder":
      return {
        title: t`Recording couldn't start`,
        description: t`Librelog couldn't open your audio input. Check your microphone selection, then try again.`,
        action: { label: t`Audio settings`, tab: "meetings" },
      };
  }
}

export async function getMicrophonePermission(): Promise<PermissionStatus | null> {
  try {
    // Outside macOS the check only probes the default input, so a missing or
    // busy microphone would read as a denied permission.
    if (platform() !== "macos") {
      return null;
    }
    const result = await permissionsCommands.checkPermission("microphone");
    return result.status === "ok" ? result.data : null;
  } catch {
    return null;
  }
}

export function showStartFailureToast(
  kind: StartFailureKind,
  openSettings: (tab: SettingsTab) => void,
) {
  const { title, description, action } = describeStartFailure(kind);
  toast.error(title, {
    id: START_FAILURE_TOAST_ID,
    description,
    ...(action
      ? {
          action: {
            label: action.label,
            onClick: () => openSettings(action.tab),
          },
        }
      : {}),
  });
}
