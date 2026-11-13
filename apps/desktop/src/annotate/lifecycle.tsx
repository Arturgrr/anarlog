import { t } from "@lingui/core/macro";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useRef, useState } from "react";

import {
  commands as annotate,
  events as annotateEvents,
  type Finalized,
  type TranscriptInput,
} from "@anlg/plugin-annotate";
import { commands as dictation } from "@anlg/plugin-dictation";
import { commands as opener } from "@anlg/plugin-opener2";
import { commands as permissions } from "@anlg/plugin-permissions";
import { commands as shortcuts, events } from "@anlg/plugin-shortcut";
import { toast } from "@anlg/ui/components/ui/toast";
import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";

import { createAnnotateFlow } from "./flow";
import { chainRegistration } from "./registration";
import { useAnnotateStatus } from "./state";
import { annotateAvailable, openScreenRecordingSettings } from "./system";

import { useDictationStatus } from "~/dictation/state";
import { localizeExternalMessage } from "~/i18n/external-messages";
import { useSettingsReady } from "~/settings/queries";
import { useConfigValue } from "~/shared/config";
import { useRunBatch } from "~/stt/useRunBatch";

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

export async function revealAnnotation(path: string) {
  unwrap(await opener.revealItemInDir(path));
}

/** Applies the retention setting now and hourly, whether Annotate is on or not. */
export function AnnotateRetention() {
  const settingsReady = useSettingsReady();
  const retention = useConfigValue("annotate_retention");
  if (!settingsReady || !annotateAvailable()) return null;
  return <ApplyRetention key={retention} retention={retention} />;
}

function ApplyRetention({ retention }: { retention: string }) {
  useMountEffect(() => {
    const preset =
      retention === "month" || retention === "forever" ? retention : "week";
    const apply = async () => {
      unwrap(await annotate.setRetention(preset));
    };
    apply().catch((error) => console.error("[annotate] retention", error));
  });
  return null;
}

export function AnnotateLifecycle() {
  const settingsReady = useSettingsReady();
  const enabled = useConfigValue("annotate_enabled");
  if (!settingsReady || !enabled || !annotateAvailable()) return null;
  return <ActiveAnnotate />;
}

type Flow = ReturnType<typeof createAnnotateFlow>;

function ActiveAnnotate() {
  const shortcut = useConfigValue("annotate_shortcut");
  const paste = useConfigValue("annotate_paste_shortcut");
  const capturingShortcut = useDictationStatus(
    (state) => state.capturingShortcut,
  );
  const [flow, setFlow] = useState<Flow | null>(null);
  const id = useRef(`annotate-${crypto.randomUUID()}`).current;
  const runBatch = useRunBatch(id);
  const microphone = useConfigValue("microphone_device");
  const current = useRef({ runBatch, microphone });
  current.current = { runBatch, microphone };

  useMountEffect(() => {
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const flow = createAnnotateFlow({
      plugin: {
        status: async () => unwrap(await annotate.status()),
        screenRecording: async () => unwrap(await annotate.screenRecording()),
        requestScreenRecording: async () =>
          unwrap(await annotate.requestScreenRecording()),
        start: async () =>
          unwrap(
            await annotate.start(current.current.microphone || null, {
              discardQuestion: t`Discard?`,
              discard: t`Discard`,
              keep: t`Keep`,
            }),
          ),
        stop: async () => unwrap(await annotate.stop()),
        finalize: async (annotation, transcript) =>
          unwrap(await annotate.finalize(annotation, transcript)),
        cancel: async () => {
          unwrap(await annotate.cancel());
        },
        setInkMode: async (mode) => {
          unwrap(await annotate.setInkMode(mode));
        },
        latest: async () => unwrap(await annotate.latest()),
      },
      microphoneAuthorized: async () =>
        unwrap(await permissions.checkPermission("microphone")) ===
        "authorized",
      transcribe: async (audioPath) => {
        let words: TranscriptInput["words"] = [];
        const used = await current.current.runBatch(audioPath, {
          deferAudioFinalization: true,
          notifyOnCompletion: false,
          numSpeakers: 1,
          handlePersist: (heard) => {
            words = heard
              .slice()
              .sort((a, b) => a.start_ms - b.start_ms)
              .map((word) => ({
                startMs: Math.max(0, Math.round(word.start_ms)),
                endMs: Math.max(0, Math.round(word.end_ms)),
                text: word.text,
              }));
          },
        });
        const text = (words ?? [])
          .map((word) => word.text)
          .join("")
          .replace(/\s+/gu, " ")
          .trim();
        if (!text) return null;
        return { provider: used.provider, model: used.model, text, words };
      },
      copy: (text) => writeText(text),
      insert: async (text) => {
        unwrap(await dictation.insertText(text));
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      setRecording: async (recording) => {
        unwrap(await shortcuts.setAnnotateRecording(recording));
      },
      setEscape: async (enabled) => {
        unwrap(await shortcuts.setAnnotateEscape(enabled));
      },
      notify: {
        ready: (finalized: Finalized) =>
          toast.success(t`Annotation ready`, {
            description: t`Its summary is on the clipboard. Use your Paste last annotation shortcut in your coding agent to paste it with its image.`,
            duration: 8_000,
            action: {
              label: t`Show in Finder`,
              onClick: () =>
                void revealAnnotation(finalized.contactSheet).catch(
                  (error: unknown) => toast.error(describe(error)),
                ),
            },
          }),
        screenRecordingDenied: () =>
          toast.error(t`Librelog can't record the screen.`, {
            description: t`Allow Librelog in System Settings › Privacy & Security › Screen Recording, then try again.`,
            duration: Infinity,
            action: {
              label: t`Open System Settings`,
              onClick: () =>
                void openScreenRecordingSettings().catch((error: unknown) =>
                  toast.error(describe(error)),
                ),
            },
          }),
        needsRestart: () =>
          toast.warning(t`Quit and reopen Librelog to record the screen.`, {
            description: t`macOS applies the Screen Recording permission after a relaunch.`,
          }),
        microphoneDenied: () =>
          toast.error(
            t`Enable microphone permission in Settings > Permissions before annotating.`,
          ),
        transcriptionFailed: (error) => {
          console.error("[annotate] transcription", error);
          toast.warning(
            t`The narration could not be transcribed. The annotation is saved without it.`,
          );
        },
        nothingToPaste: () => toast(t`There's no annotation to paste yet.`),
        error: (error) => {
          if (!disposed) toast.error(describe(error));
        },
      },
      onPhase: (phase) => useAnnotateStatus.setState({ phase }),
    });
    void annotateEvents.annotateEvent
      .listen(({ payload }) => void flow.onEvent(payload))
      .then((stop) => (disposed ? stop() : unlisteners.push(stop)));
    void events.annotateShortcutEvent
      .listen(({ payload }) => {
        if (useDictationStatus.getState().capturingShortcut) return;
        void flow.onShortcut(payload.type);
      })
      .then((stop) => (disposed ? stop() : unlisteners.push(stop)));
    void events.pasteLastAnnotationEvent
      .listen(() => void flow.pasteLast())
      .then((stop) => (disposed ? stop() : unlisteners.push(stop)));
    // A recording that outlived a reload, or stopped while nobody listened.
    void flow.recover();
    setFlow(flow);
    return () => {
      disposed = true;
      for (const stop of unlisteners) stop();
      useAnnotateStatus.setState({ phase: "idle" });
      void flow.discard();
    };
  });

  if (!flow || capturingShortcut) return null;
  return (
    <AnnotateShortcuts
      key={`${shortcut}:${paste}`}
      shortcut={shortcut}
      paste={paste}
    />
  );
}

// Registered again when either shortcut changes, and released while a
// shortcut recorder listens for keys.
function AnnotateShortcuts({
  shortcut,
  paste,
}: {
  shortcut: string;
  paste: string;
}) {
  useMountEffect(() => {
    let disposed = false;
    chainRegistration(async () => {
      if (disposed) return;
      unwrap(await shortcuts.configureAnnotate(shortcut, paste));
      useAnnotateStatus.setState({ error: null });
    }).catch((error) => {
      if (disposed) return;
      const message = describe(error);
      useAnnotateStatus.setState({ error: message });
      toast.error(message);
    });
    return () => {
      disposed = true;
      useAnnotateStatus.setState({ error: null });
      chainRegistration(async () => {
        unwrap(await shortcuts.configureAnnotate(null, null));
      }).catch((error) => console.error("[annotate] unregister", error));
    };
  });
  return null;
}
