import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";

import { commands as annotate } from "@anlg/plugin-annotate";
import {
  commands as capture,
  events as captureEvents,
  type CaptureEntry,
  type CaptureLabels,
} from "@anlg/plugin-capture";
import { commands as opener } from "@anlg/plugin-opener2";
import { commands as permissions } from "@anlg/plugin-permissions";
import { commands as shortcuts, events } from "@anlg/plugin-shortcut";
import { commands as tray } from "@anlg/plugin-tray";
import { commands as windows } from "@anlg/plugin-windows";
import { toast } from "@anlg/ui/components/ui/toast";
import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";

import { type CaptureSettings, createCaptureFlow } from "./flow";
import { chainRegistration } from "./registration";
import { captureRuns, useCaptureStatus } from "./state";
import { captureAvailable, useCaptureShortcutMap } from "./system";

import { openScreenRecordingSettings } from "~/annotate/system";
import { useDictationStatus } from "~/dictation/state";
import { localizeExternalMessage } from "~/i18n/external-messages";
import { useSettingsReady } from "~/settings/queries";
import { useConfigValue, useConfigValues } from "~/shared/config";
import { isAppWindowInactive } from "~/shared/window-activity";

export function unwrap<T>(
  result: { status: "ok"; data: T } | { status: "error"; error: string },
): T {
  if (result.status === "error") throw new Error(result.error);
  return result.data;
}

export function describeError(error: unknown) {
  return localizeExternalMessage(
    error instanceof Error ? error.message : String(error),
  );
}

export async function openCaptureEditor(id: string) {
  unwrap(await windows.windowShow({ type: "captureEditor", value: id }));
}

export async function revealCapture(path: string) {
  unwrap(await opener.revealItemInDir(path));
}

/** The words the selectors, the capsule and the cards show. */
export function useCaptureLabels(): CaptureLabels {
  const { t } = useLingui();
  return {
    areaHint: t`Drag to capture · Space for a window · Esc to cancel`,
    windowHint: t`Click a window · Space for an area · Esc to cancel`,
    discardQuestion: t`Discard?`,
    discard: t`Discard`,
    keep: t`Keep`,
    copy: t`Copy`,
    save: t`Save`,
    show: t`Show in Finder`,
    edit: t`Edit`,
    close: t`Close`,
  };
}

function useCaptureSettings(): CaptureSettings {
  const values = useConfigValues([
    "capture_copy_to_clipboard",
    "capture_save_to_folder",
    "capture_folder",
    "capture_show_card",
    "capture_open_editor",
    "capture_image_format",
    "capture_show_cursor",
    "capture_record_fps",
    "capture_record_cursor",
    "capture_record_microphone",
    "capture_record_system_audio",
    "capture_record_countdown",
    "capture_gif_fps",
    "capture_gif_max_width",
  ] as const);
  return {
    copy: values.capture_copy_to_clipboard,
    saveToFolder: values.capture_save_to_folder,
    folder: values.capture_folder,
    showCard: values.capture_show_card,
    openEditor: values.capture_open_editor,
    imageFormat: values.capture_image_format,
    showCursor: values.capture_show_cursor,
    recordFps: values.capture_record_fps,
    recordCursor: values.capture_record_cursor,
    microphone: values.capture_record_microphone,
    systemAudio: values.capture_record_system_audio,
    countdown: values.capture_record_countdown,
    gifFps: values.capture_gif_fps,
    gifMaxWidth: values.capture_gif_max_width,
  };
}

export function CaptureLifecycle() {
  const settingsReady = useSettingsReady();
  const enabled = useConfigValue("capture_enabled");
  const phase = useCaptureStatus((state) => state.phase);
  if (!settingsReady || !captureAvailable() || !captureRuns(enabled, phase)) {
    return null;
  }
  return <ActiveCapture />;
}

function savedToast(entry: CaptureEntry, copied: boolean) {
  const inFolder = !entry.inLibrary;
  const title =
    copied && !inFolder
      ? t`Copied to clipboard`
      : entry.kind === "screenshot"
        ? t`Screenshot saved`
        : t`Recording saved`;
  toast.success(title, {
    description:
      copied && inFolder ? t`Also copied to the clipboard.` : undefined,
    action:
      copied && !inFolder
        ? undefined
        : {
            label: t`Show in Finder`,
            onClick: () =>
              void revealCapture(entry.path).catch((error: unknown) =>
                toast.error(describeError(error)),
              ),
          },
  });
}

function ActiveCapture() {
  const settings = useCaptureSettings();
  const labels = useCaptureLabels();
  const map = useCaptureShortcutMap();
  const capturingShortcut = useDictationStatus(
    (state) => state.capturingShortcut,
  );
  const [ready, setReady] = useState(false);
  const current = useRef({ settings, labels });
  current.current = { settings, labels };

  useMountEffect(() => {
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const flow = createCaptureFlow({
      plugin: {
        status: async () => unwrap(await capture.status()),
        screenRecording: async () => unwrap(await annotate.screenRecording()),
        requestScreenRecording: async () =>
          unwrap(await annotate.requestScreenRecording()),
        screenshot: async (request) =>
          unwrap(await capture.screenshot(request)),
        startRecording: async (request) =>
          unwrap(await capture.startRecording(request)),
        stopRecording: async () => unwrap(await capture.stopRecording()),
        listCaptures: async () => unwrap(await capture.listCaptures()),
      },
      settings: () => current.current.settings,
      labels: () => current.current.labels,
      microphoneAuthorized: async () =>
        unwrap(await permissions.checkPermission("microphone")) ===
        "authorized",
      frontmost: async () => !(await isAppWindowInactive()),
      openEditor: openCaptureEditor,
      openFile: async (path) => {
        unwrap(await opener.openPath(path, null));
      },
      notify: {
        captured: savedToast,
        screenRecordingDenied: () =>
          toast.error(t`Librelog can't capture the screen.`, {
            description: t`Allow Librelog in System Settings › Privacy & Security › Screen Recording, then try again.`,
            duration: Infinity,
            action: {
              label: t`Open System Settings`,
              onClick: () =>
                void openScreenRecordingSettings().catch((error: unknown) =>
                  toast.error(describeError(error)),
                ),
            },
          }),
        needsRestart: () =>
          toast.warning(t`Quit and reopen Librelog to capture the screen.`, {
            description: t`macOS applies the Screen Recording permission after a relaunch.`,
          }),
        microphoneDenied: () =>
          toast.error(
            t`Enable microphone permission in Settings > Permissions, or turn off recording the microphone for screen recordings.`,
          ),
        error: (error) => {
          if (!disposed) toast.error(describeError(error));
        },
      },
      onPhase: (phase) => useCaptureStatus.setState({ phase }),
    });
    void captureEvents.captureEvent
      .listen(({ payload }) => void flow.onEvent(payload))
      .then((stop) => (disposed ? stop() : unlisteners.push(stop)));
    void events.captureShortcutEvent
      .listen(({ payload }) => {
        if (useDictationStatus.getState().capturingShortcut) return;
        void flow.onShortcut(payload.action);
      })
      .then((stop) => (disposed ? stop() : unlisteners.push(stop)));
    // A recording that outlived a reload.
    void flow.recover();
    setReady(true);
    return () => {
      disposed = true;
      for (const stop of unlisteners) stop();
      useCaptureStatus.setState({ phase: "idle" });
    };
  });

  useMountEffect(() => {
    const show = (visible: boolean) =>
      tray
        .setTrayCaptureVisible(visible)
        .then(unwrap)
        .catch((error) => console.error("[capture] tray", error));
    void show(true);
    return () => void show(false);
  });

  if (!ready || capturingShortcut) return null;
  const key = Object.values(map).join("|");
  return <CaptureShortcuts key={key} shortcuts={map} />;
}

// Registered again when any shortcut changes, and released while a shortcut
// recorder listens for keys.
function CaptureShortcuts({
  shortcuts: keys,
}: {
  shortcuts: ReturnType<typeof useCaptureShortcutMap>;
}) {
  useMountEffect(() => {
    let disposed = false;
    chainRegistration(async () => {
      if (disposed) return;
      unwrap(
        await shortcuts.configureCapture({
          area: keys.area || null,
          fullscreen: keys.fullscreen || null,
          window: keys.window || null,
          record: keys.record || null,
          gif: keys.gif || null,
        }),
      );
      useCaptureStatus.setState({ error: null });
    }).catch((error) => {
      if (disposed) return;
      const message = describeError(error);
      useCaptureStatus.setState({ error: message });
      toast.error(message);
    });
    return () => {
      disposed = true;
      useCaptureStatus.setState({ error: null });
      chainRegistration(async () => {
        unwrap(
          await shortcuts.configureCapture({
            area: null,
            fullscreen: null,
            window: null,
            record: null,
            gif: null,
          }),
        );
      }).catch((error) => console.error("[capture] unregister", error));
    };
  });
  return null;
}
