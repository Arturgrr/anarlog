import { useCallback, useState } from "react";

import { commands as notificationCommands } from "@anlg/plugin-notification";
import { toast } from "@anlg/ui/components/ui/toast";

import { populateRecurringMeetingNotes } from "./recurring-notes";

import { useLocalUserId } from "~/shared/owner-user";
import {
  type DevtoolsOtaPreviewStatus,
  useDevtoolsOtaPreview,
} from "~/store/zustand/devtools-ota-preview";
import {
  type DevtoolsToastPreview,
  useDevtoolsToastPreview,
} from "~/store/zustand/devtools-toast-preview";
import { listenerStore } from "~/store/zustand/listener/instance";
import { useTabs } from "~/store/zustand/tabs";
import {
  AUTO_STOP_CONFIRM_TIMEOUT_SECONDS,
  createAutoStopEndedNotificationKey,
} from "~/stt/auto-stop-notification";

export type DevtoolsAction =
  | "navigation:onboarding"
  | `toasts:preview:${DevtoolsToastPreview}`
  | "toasts:clear"
  | `ota:${DevtoolsOtaPreviewStatus}`
  | "ota:clear"
  | "notifications:mic-detected"
  | "notifications:mic-options"
  | "notifications:auto-stop"
  | "notifications:clear"
  | "data:recurring-notes"
  | "error:trigger";

type DevtoolsMenuItem = {
  label: string;
  description: string;
  action: DevtoolsAction;
  destructive?: boolean;
};

export type DevtoolsMenuGroup = {
  label: string;
  description: string;
  items: DevtoolsMenuItem[];
};

export const DEVTOOLS_MENU: DevtoolsMenuGroup[] = [
  {
    label: "Navigation",
    description: "Reopen flows that are normally only reachable once.",
    items: [
      {
        label: "Onboarding",
        description: "Open the onboarding tab as a first-time user sees it.",
        action: "navigation:onboarding",
      },
    ],
  },
  {
    label: "Toasts",
    description:
      "Preview each sidebar toast without meeting its real trigger condition.",
    items: [
      {
        label: "Language model",
        description: "Preview the toast asking for a language model provider.",
        action: "toasts:preview:language-model",
      },
      {
        label: "Transcription model",
        description:
          "Preview the toast asking for a transcription provider or model.",
        action: "toasts:preview:transcription-model",
      },
      {
        label: "Transcription error",
        description: "Preview the toast shown when transcription fails.",
        action: "toasts:preview:transcription-error",
      },
      {
        label: "Download",
        description: "Preview the model download progress toast.",
        action: "toasts:preview:download",
      },
      {
        label: "Clear all toasts",
        description: "Dismiss every previewed toast.",
        action: "toasts:clear",
        destructive: true,
      },
    ],
  },
  {
    label: "OTA",
    description: "Simulate updater states without publishing a release.",
    items: [
      {
        label: "Available",
        description:
          "Show the banner for a new version that can be downloaded.",
        action: "ota:available",
      },
      {
        label: "Downloading",
        description: "Show the banner with download progress.",
        action: "ota:downloading",
      },
      {
        label: "Ready",
        description: "Show the banner asking to restart and install.",
        action: "ota:ready",
      },
      {
        label: "Failed",
        description: "Show the banner for a failed update.",
        action: "ota:failed",
      },
      {
        label: "Clear",
        description: "Remove the simulated update state.",
        action: "ota:clear",
        destructive: true,
      },
    ],
  },
  {
    label: "Notifications",
    description: "Fire each native notification with sample data.",
    items: [
      {
        label: "Mic detected",
        description:
          'Show the "Are you in a meeting?" notification for a detected app.',
        action: "notifications:mic-detected",
      },
      {
        label: "Mic options",
        description:
          "Show the meeting-detected notification with the ignore-these-apps footer.",
        action: "notifications:mic-options",
      },
      {
        label: "Auto-stop",
        description:
          'Show the "Did your meeting end?" countdown for the live session.',
        action: "notifications:auto-stop",
      },
      {
        label: "Clear",
        description: "Dismiss all native notifications.",
        action: "notifications:clear",
        destructive: true,
      },
    ],
  },
  {
    label: "Data",
    description: "Seed sample data into the local database.",
    items: [
      {
        label: "Seed recurring meeting notes",
        description:
          "Create a repeated meeting with three past notes and key facts to exercise the Insights tab.",
        action: "data:recurring-notes",
      },
    ],
  },
  {
    label: "Error",
    description: "Break the UI on purpose to check error handling.",
    items: [
      {
        label: "Trigger error",
        description:
          "Throw from the bar to show the error screen. Reload to recover.",
        action: "error:trigger",
        destructive: true,
      },
    ],
  },
];

export function useDevtoolsActions() {
  const openNew = useTabs((state) => state.openNew);
  const userId = useLocalUserId() ?? undefined;
  const showToastPreview = useDevtoolsToastPreview(
    (state) => state.showPreview,
  );
  const clearToastPreview = useDevtoolsToastPreview(
    (state) => state.clearPreview,
  );
  const showOtaPreview = useDevtoolsOtaPreview((state) => state.showPreview);
  const clearOtaPreview = useDevtoolsOtaPreview((state) => state.clearPreview);
  const [shouldThrow, setShouldThrow] = useState(false);

  if (shouldThrow) {
    throw new Error("Test error triggered from devtools");
  }

  const clearNotifications = useCallback(async () => {
    try {
      await notificationCommands.clearNotifications();
    } catch (error) {
      console.error("[devtools] failed to clear notifications", error);
    }
  }, []);

  const showMicDetectedNotification = useCallback(async () => {
    await notificationCommands.showNotification({
      key: `devtool-mic-${crypto.randomUUID()}`,
      title: "Are you in a meeting?",
      message: "",
      timeout: { secs: 15, nanos: 0 },
      source: {
        type: "mic_detected",
        app_names: ["Zoom"],
        app_ids: ["us.zoom.xos"],
      },
      start_time: null,
      participants: null,
      event_details: null,
      action_label: null,
      action: null,
      action_menu: null,
      action_variant: null,
      options: null,
      footer: null,
      icon: null,
    });
  }, []);

  const showMicOptionsNotification = useCallback(async () => {
    await notificationCommands.showNotification({
      key: `devtool-mic-options-${crypto.randomUUID()}`,
      title: "Are you in a meeting?",
      message: "",
      timeout: { secs: 15, nanos: 0 },
      source: {
        type: "mic_detected",
        app_names: ["Zoom", "Google Chrome"],
        app_ids: ["us.zoom.xos", "com.google.Chrome"],
      },
      start_time: null,
      participants: null,
      event_details: null,
      action_label: "Yes",
      action: null,
      action_menu: null,
      action_variant: null,
      options: null,
      footer: {
        text: "Ignore Zoom and Chrome?",
        actionLabel: "Ignore them",
        icon: { type: "bundle_id", bundle_id: "us.zoom.xos" },
      },
      icon: null,
    });
  }, []);

  const showAutoStopNotification = useCallback(async () => {
    const sessionId =
      listenerStore.getState().live.sessionId ??
      `devtool-${crypto.randomUUID()}`;

    await notificationCommands.showNotification({
      key: createAutoStopEndedNotificationKey(sessionId),
      title: "Did your meeting end?",
      message: `Librelog will stop listening in ${AUTO_STOP_CONFIRM_TIMEOUT_SECONDS} seconds.`,
      timeout: { secs: AUTO_STOP_CONFIRM_TIMEOUT_SECONDS, nanos: 0 },
      source: null,
      start_time: null,
      participants: null,
      event_details: null,
      action_label: "Stop",
      action: null,
      action_menu: null,
      action_variant: "destructive",
      options: null,
      footer: null,
      icon: { type: "bundle_id", bundle_id: "com.google.Chrome" },
    });
  }, []);

  const seedRecurringNotes = useCallback(async () => {
    try {
      const sessionId = await populateRecurringMeetingNotes({ userId });
      openNew({ type: "sessions", id: sessionId });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to seed notes",
      );
    }
  }, [openNew, userId]);

  const run = useCallback(
    (action: DevtoolsAction) => {
      switch (action) {
        case "navigation:onboarding":
          openNew({ type: "onboarding" });
          return;
        case "toasts:preview:language-model":
        case "toasts:preview:transcription-model":
        case "toasts:preview:transcription-error":
        case "toasts:preview:download":
          showToastPreview(
            action.slice("toasts:preview:".length) as DevtoolsToastPreview,
          );
          return;
        case "toasts:clear":
          clearToastPreview();
          return;
        case "ota:available":
        case "ota:downloading":
        case "ota:ready":
        case "ota:failed":
          showOtaPreview(
            action.slice("ota:".length) as DevtoolsOtaPreviewStatus,
          );
          return;
        case "ota:clear":
          clearOtaPreview();
          return;
        case "notifications:mic-detected":
          void showMicDetectedNotification();
          return;
        case "notifications:mic-options":
          void showMicOptionsNotification();
          return;
        case "notifications:auto-stop":
          void showAutoStopNotification();
          return;
        case "notifications:clear":
          void clearNotifications();
          return;
        case "data:recurring-notes":
          void seedRecurringNotes();
          return;
        case "error:trigger":
          setShouldThrow(true);
          return;
      }
    },
    [
      clearNotifications,
      clearOtaPreview,
      clearToastPreview,
      openNew,
      seedRecurringNotes,
      showAutoStopNotification,
      showMicDetectedNotification,
      showMicOptionsNotification,
      showOtaPreview,
      showToastPreview,
    ],
  );

  return run;
}
