import { t } from "@lingui/core/macro";
import { Channel } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { useRef } from "react";

import {
  commands as dictation,
  type HudEvent,
  type RecordingUpdate,
} from "@anlg/plugin-dictation";
import { commands as permissions } from "@anlg/plugin-permissions";
import { type AppSounds, commands as sfx } from "@anlg/plugin-sfx";
import { commands as shortcuts, events } from "@anlg/plugin-shortcut";
import { commands as transcription } from "@anlg/plugin-transcription";
import { toast } from "@anlg/ui/components/ui/toast";
import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";

import { DictationController } from "./controller";
import { useDictationStatus } from "./state";

import { localizeExternalMessage } from "~/i18n/external-messages";
import { useSettingsReady } from "~/settings/queries";
import { useConfigValue } from "~/shared/config";
import { useListener } from "~/stt/contexts";
import { useRunBatch } from "~/stt/useRunBatch";
import { useSTTConnection } from "~/stt/useSTTConnection";
export { useDictationStatus } from "./state";

let lifecycle: Promise<void> = Promise.resolve();

export function waitForDictationCleanup() {
  return lifecycle;
}

export function DictationLifecycle() {
  const settingsReady = useSettingsReady();
  const enabled = useConfigValue("dictation_enabled");
  const shortcuts = useConfigValue("dictation_shortcuts");
  const handsFree = useConfigValue("dictation_hands_free");
  const capturingShortcut = useDictationStatus(
    (state) => state.capturingShortcut,
  );
  const retry = useDictationStatus((state) => state.retry);

  if (!settingsReady || !enabled) return null;
  return (
    <TranscriptRetention>
      {!capturingShortcut && (
        <ActiveDictation
          key={`${JSON.stringify(shortcuts)}:${handsFree}:${retry}`}
          shortcuts={shortcuts}
          handsFree={handsFree}
        />
      )}
    </TranscriptRetention>
  );
}

function TranscriptRetention({ children }: { children: React.ReactNode }) {
  useMountEffect(() => () => {
    useDictationStatus.setState({ lastTranscript: "" });
  });
  return children;
}

function unwrap<T>(
  result: { status: "ok"; data: T } | { status: "error"; error: string },
): T {
  if (result.status === "error") throw new Error(result.error);
  return result.data;
}

// This computer or its network, where a self-hosted server may live; an
// address that isn't a web URL is one of Librelog's own engines.
function isLocalServer(baseUrl: string) {
  let host: string;
  try {
    const url = new URL(baseUrl);
    if (!/^(?:https?|wss?):$/u.test(url.protocol)) return true;
    host = url.hostname.toLowerCase();
  } catch {
    return true;
  }
  if (host === "localhost" || /\.(?:localhost|local)$/u.test(host)) return true;
  if (host.startsWith("[")) return /^\[(?:::1?\]|f[cd]|fe[89ab])/u.test(host);
  const ipv4 = /^(\d+)\.(\d+)\.\d+\.\d+$/u.exec(host);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  return (
    [0, 10, 127].includes(a) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function ActiveDictation({
  shortcuts: configured,
  handsFree,
}: {
  shortcuts: string[];
  handsFree: boolean;
}) {
  const id = useRef(`system-dictation-${crypto.randomUUID()}`).current;
  const runBatch = useRunBatch(id);
  const stopTranscription = useListener((state) => state.stopTranscription);
  const microphone = useConfigValue("microphone_device");
  const livePreview = useConfigValue("dictation_live_preview");
  const dictionary = useConfigValue("personalization_dictionary_terms");
  const languages = useConfigValue("spoken_languages");
  const sounds = useConfigValue("dictation_sounds");
  const meetingActive = useListener(
    (state) => state.live.status !== "inactive" || state.live.loading,
  );
  const { conn } = useSTTConnection();
  const current = useRef({
    runBatch,
    microphone,
    livePreview,
    languages,
    dictionary,
    sounds,
    meetingActive,
    conn,
  });
  current.current = {
    runBatch,
    microphone,
    livePreview,
    languages,
    dictionary,
    sounds,
    meetingActive,
    conn,
  };

  useMountEffect(() => {
    let disposed = false;
    let armed = false;
    let target = "";
    let finalTranscript: string | null = null;
    let unlisten: (() => void) | undefined;
    let abort = new AbortController();
    let presentation: Promise<void> = Promise.resolve();
    // Whether this dictation's HUD is up, and how it ended; anything that
    // ends without completing or cancelling failed.
    let hudShown = false;
    let outcome: "completed" | "cancelled" | null = null;
    // One at a time, so the HUD sees events in the order they happened.
    let hudEvents: Promise<unknown> = Promise.resolve();
    const hud = (event: HudEvent) => {
      if (!hudShown) return;
      hudEvents = hudEvents.then(async () => {
        await dictation.hud(event);
      });
    };
    const onError = (error: unknown) => {
      if (disposed) return;
      const message = localizeExternalMessage(
        error instanceof Error ? error.message : String(error),
      );
      useDictationStatus.setState({ error: message });
      toast.error(message);
    };
    // Through the speakers a cue would reach the microphone, so it never plays
    // while a meeting records: it would leak into the call and its recording.
    const cue = async (sound: AppSounds) => {
      const { sounds, meetingActive } = current.current;
      if (disposed || !sounds || meetingActive) return;
      try {
        const capture = unwrap(await transcription.getCaptureState());
        if (capture === "inactive") await sfx.play(sound);
      } catch (error) {
        console.error(error);
      }
    };
    const meetingRecording = async () => {
      if (current.current.meetingActive) return true;
      const capture = await transcription.getCaptureState();
      return capture.status === "error" || capture.data !== "inactive";
    };
    const controller = new DictationController({
      handsFree,
      start: async () => {
        abort = new AbortController();
        finalTranscript = null;
        outcome = null;
        const recordingAbort = abort;
        const { microphone, livePreview, conn, languages, dictionary } =
          current.current;
        useDictationStatus.setState({ error: null });
        if (platform() === "macos") {
          const permission = unwrap(
            await permissions.checkPermission("microphone"),
          );
          if (permission !== "authorized")
            throw new Error(
              t`Enable microphone permission in Settings > Permissions before dictating.`,
            );
        }
        abort.signal.throwIfAborted();
        // Ahead of the microphone, so the cue answers the press and stays
        // mostly out of the recording.
        void cue("StartRecording");
        target = unwrap(await dictation.captureTarget());
        // A self-hosted server may take one live connection at a time, and a
        // second one would cut off the meeting's transcript. The dictation is
        // then transcribed when you finish.
        const preview =
          conn && !(isLocalServer(conn.baseUrl) && (await meetingRecording()))
            ? {
                provider: conn.provider,
                baseUrl: conn.baseUrl,
                apiKey: conn.apiKey,
                params: {
                  model: conn.model,
                  channels: 1,
                  sample_rate: 16000,
                  languages: languages || [],
                  keywords: dictionary || [],
                  num_speakers: 1,
                  min_speakers: null,
                  max_speakers: null,
                  custom_query: null,
                },
              }
            : null;
        abort.signal.throwIfAborted();
        // The HUD is on screen before the microphone opens.
        const shown = await dictation.hud({ type: "started" });
        if (shown.status === "error")
          throw new Error(
            t`Could not show the dictation indicator. Please try again.`,
          );
        hudShown = true;
        abort.signal.throwIfAborted();
        unwrap(
          await dictation.startSystemRecording(
            microphone || null,
            id,
            preview,
            new Channel<RecordingUpdate>((update) => {
              if (
                disposed ||
                !livePreview ||
                update.type !== "transcript" ||
                recordingAbort.signal.aborted ||
                recordingAbort !== abort ||
                !["starting", "recording"].includes(
                  useDictationStatus.getState().phase,
                )
              )
                return;
              hud({
                type: "preview",
                stable: update.text,
                tentative:
                  update.text && update.partial
                    ? ` ${update.partial}`
                    : update.partial,
              });
            }),
          ),
        );
      },
      stop: async () => {
        const recorded = unwrap(await dictation.stopRecording(id));
        finalTranscript = recorded.transcript ?? null;
        return recorded.filePath;
      },
      cancel: async () => {
        unwrap(await dictation.cancelRecording(id));
      },
      transcribe: async (path) => {
        if (finalTranscript !== null) return finalTranscript;
        let text = "";
        await current.current.runBatch(path, {
          signal: abort.signal,
          deferAudioFinalization: true,
          notifyOnCompletion: false,
          numSpeakers: 1,
          handlePersist: (words) => {
            text = words
              .slice()
              .sort((a, b) => a.start_ms - b.start_ms)
              .map((word) => word.text)
              .join("")
              .replace(/\s+/gu, " ")
              .trim();
          },
        });
        return text;
      },
      insert: async (text) => {
        if (disposed) return;
        unwrap(await dictation.insertText(target, text));
        outcome = "completed";
      },
      discard: async (path) => {
        unwrap(await dictation.discardRecording(path));
      },
      onTranscript: (lastTranscript) => {
        if (!disposed) useDictationStatus.setState({ lastTranscript });
      },
      onError,
      onPhase: (phase) => {
        if (!disposed) useDictationStatus.setState({ phase });
        if (phase === "transcribing") {
          hud({ type: "processing" });
          void cue("StopRecording");
        }
        if (phase === "idle") {
          hud({ type: outcome ?? "failed" });
          hudShown = false;
        }
        presentation = presentation
          .then(async () => {
            try {
              unwrap(await shortcuts.setActive(phase !== "idle" && !disposed));
            } catch (error) {
              onError(error);
            }
          })
          .catch(onError);
      },
    });
    const cancel = () => {
      outcome ??= "cancelled";
      abort.abort();
      void controller.cancel();
      void stopTranscription(id).catch(onError);
    };

    lifecycle = lifecycle
      .then(async () => {
        if (disposed) return;
        unlisten = await events.shortcutEvent.listen(({ payload }) => {
          if (
            disposed ||
            !armed ||
            useDictationStatus.getState().capturingShortcut
          )
            return;
          if (payload.type === "pressed") controller.press();
          else if (payload.type === "released") controller.release();
          else cancel();
        });
        if (disposed) {
          unlisten();
          return;
        }
        unwrap(await shortcuts.configure(configured));
        armed = !disposed;
        if (!disposed)
          useDictationStatus.setState({ ready: true, error: null, cancel });
      })
      .catch(onError);

    return () => {
      disposed = true;
      armed = false;
      unlisten?.();
      cancel();
      useDictationStatus.setState({
        ready: false,
        phase: "idle",
        lastTranscript: useDictationStatus.getState().lastTranscript,
        cancel: null,
      });
      lifecycle = lifecycle
        .then(async () => {
          unlisten?.();
          await controller.cancel();
          await presentation;
          unwrap(await shortcuts.configure([]));
        })
        .catch(() => {});
    };
  });
  return null;
}
