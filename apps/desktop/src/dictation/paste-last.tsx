import { t } from "@lingui/core/macro";
import { platform } from "@tauri-apps/plugin-os";
import { create } from "zustand";

import { commands as dictation } from "@anlg/plugin-dictation";
import { commands as shortcuts, events } from "@anlg/plugin-shortcut";
import { commands as tray } from "@anlg/plugin-tray";
import { toast } from "@anlg/ui/components/ui/toast";
import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";

import { latestDictation } from "./history/store";
import { waitForDictationCleanup } from "./lifecycle";
import { useDictationStatus } from "./state";

import { localizeExternalMessage } from "~/i18n/external-messages";
import { useSettingsReady } from "~/settings/queries";
import { useConfigValue } from "~/shared/config";

export const usePasteLastStatus = create<{ error: string | null }>(() => ({
  error: null,
}));

let registration: Promise<void> = Promise.resolve();
let trayUpdates: Promise<void> = Promise.resolve();
let pasting = false;

export function waitForPasteLastCleanup() {
  return registration;
}

/** The newest dictation in the history, or this session's while history is off. */
export async function getLastDictation(): Promise<string | null> {
  const latest = await latestDictation().catch((error: unknown) => {
    console.error("[paste-last] history", error);
    return null;
  });
  return latest?.text || useDictationStatus.getState().lastTranscript || null;
}

// A paste would type through the held shortcut keys or end the capture.
// Dictations waiting to be inserted take turns with it instead.
export function isDictating() {
  return useDictationStatus.getState().capturing;
}

function unwrap<T>(
  result: { status: "ok"; data: T } | { status: "error"; error: string },
): T {
  if (result.status === "error") throw new Error(result.error);
  return result.data;
}

function describe(error: unknown) {
  return localizeExternalMessage(
    error instanceof Error ? error.message : String(error),
  );
}

async function pasteLast() {
  if (pasting) return;
  if (isDictating()) {
    toast.error(t`Finish dictating before pasting your last dictation.`);
    return;
  }
  pasting = true;
  try {
    const text = await getLastDictation();
    if (!text) {
      toast(t`There's no dictation to paste yet.`);
      return;
    }
    unwrap(await dictation.insertText(text));
  } catch (error) {
    toast.error(describe(error));
  } finally {
    pasting = false;
  }
}

function showTrayItem(visible: boolean) {
  trayUpdates = trayUpdates
    .then(async () => {
      unwrap(await tray.setTrayPasteLastVisible(visible));
    })
    .catch((error) => console.error("[paste-last] tray item", error));
}

export function PasteLastLifecycle() {
  const settingsReady = useSettingsReady();
  const dictationEnabled = useConfigValue("dictation_enabled");
  const enabled = useConfigValue("dictation_paste_last_enabled");
  const shortcut = useConfigValue("dictation_paste_last_shortcut");
  const capturingShortcut = useDictationStatus(
    (state) => state.capturingShortcut,
  );

  if (!settingsReady || !dictationEnabled || !enabled) return null;
  return (
    <>
      <PasteLastRequests />
      {!capturingShortcut && (
        <PasteLastShortcut key={shortcut} shortcut={shortcut} />
      )}
    </>
  );
}

// Only the macOS menu bar has the menu item: clicking the notification area
// on Windows and Linux takes focus from the app the text should go to.
function PasteLastRequests() {
  useMountEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const tray = platform() === "macos";
    void events.pasteLastEvent
      .listen(() => void pasteLast())
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      });
    if (tray) showTrayItem(true);
    return () => {
      disposed = true;
      unlisten?.();
      if (tray) showTrayItem(false);
    };
  });
  return null;
}

// Registered after the dictation shortcuts settle, and released while a
// shortcut recorder listens for keys.
function PasteLastShortcut({ shortcut }: { shortcut: string }) {
  useMountEffect(() => {
    let disposed = false;
    registration = registration
      .then(() => waitForDictationCleanup())
      .then(async () => {
        if (disposed) return;
        unwrap(await shortcuts.configurePasteLast(shortcut));
        usePasteLastStatus.setState({ error: null });
      })
      .catch((error) => {
        if (disposed) return;
        const message = describe(error);
        usePasteLastStatus.setState({ error: message });
        toast.error(message);
      });
    return () => {
      disposed = true;
      usePasteLastStatus.setState({ error: null });
      registration = registration
        .then(async () => {
          unwrap(await shortcuts.configurePasteLast(null));
        })
        .catch((error) => console.error("[paste-last] unregister", error));
    };
  });
  return null;
}
