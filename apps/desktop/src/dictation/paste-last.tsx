import { t } from "@lingui/core/macro";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { create } from "zustand";

import { commands as dictation } from "@anlg/plugin-dictation";
import { commands as shortcuts, events } from "@anlg/plugin-shortcut";
import { commands as tray } from "@anlg/plugin-tray";
import { toast } from "@anlg/ui/components/ui/toast";
import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";

import { waitForDictationCleanup } from "./lifecycle";
import { useDictationStatus } from "./state";

import { localizeExternalMessage } from "~/i18n/external-messages";
import { getStoredSettingValues, useSettingsReady } from "~/settings/queries";
import { resolveConfigValue, useConfigValue } from "~/shared/config";

export const usePasteLastStatus = create<{ error: string | null }>(() => ({
  error: null,
}));

let registration: Promise<void> = Promise.resolve();
let trayUpdates: Promise<void> = Promise.resolve();
let pasting = false;

export function waitForPasteLastCleanup() {
  return registration;
}

export async function getLastDictation(): Promise<string | null> {
  return useDictationStatus.getState().lastTranscript || null;
}

// Transcribing counts too: on macOS a paste would take the one insertion
// target the dictation captured when it started.
export function isDictating() {
  return useDictationStatus.getState().phase !== "idle";
}

export async function keepOnClipboard(text: string): Promise<void> {
  const stored = await getStoredSettingValues();
  if (resolveConfigValue("dictation_keep_on_clipboard", stored)) {
    await writeText(text);
  }
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
    const target = unwrap(await dictation.captureTarget());
    unwrap(await dictation.insertText(target, text));
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

function PasteLastRequests() {
  useMountEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void events.pasteLastEvent
      .listen(() => void pasteLast())
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      });
    showTrayItem(true);
    return () => {
      disposed = true;
      unlisten?.();
      showTrayItem(false);
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
