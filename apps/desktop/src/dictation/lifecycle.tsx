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
    let unlisten: (() => void) | undefined;
    let presentation: Promise<void> = Promise.resolve();
    let status = { phase: "idle", capturing: false, pending: 0 };
    // The capture whose live words the HUD shows.
    let live: object | null = null;
    let hudShown = false;
    // One at a time, so the HUD sees events in the order they happened.
    let hudEvents: Promise<unknown> = Promise.resolve();
    const sendHud = (event: HudEvent) => {
      const sent = hudEvents.then(() => dictation.hud(event));
      hudEvents = sent.catch(() => {});
      return sent;
    };
    const hud = (event: HudEvent) => {
      if (hudShown) void sendHud(event);
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
      start: async (signal) => {
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
        signal.throwIfAborted();
        // Ahead of the microphone, so the cue answers the press and stays
        // mostly out of the recording.
        void cue("StartRecording");
        const target = unwrap(await dictation.captureTarget());
        // A self-hosted server may take one live connection at a time: a
        // second one would cut off the meeting's transcript, or contend with
        // an earlier dictation still finishing or transcribing there. This
        // dictation is then transcribed when its turn comes.
        const preview =
          conn &&
          !(
            isLocalServer(conn.baseUrl) &&
            (status.pending > 0 || (await meetingRecording()))
          )
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
        signal.throwIfAborted();
        // The HUD is on screen before the microphone opens.
        const shown = await sendHud({ type: "started" });
        if (shown.status === "error")
          throw new Error(
            t`Could not show the dictation indicator. Please try again.`,
          );
        hudShown = true;
        signal.throwIfAborted();
        const capture = {};
        live = capture;
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
                signal.aborted ||
                live !== capture
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
        return target;
      },
      stop: async () => {
        live = null;
        void cue("StopRecording");
        return unwrap(await dictation.stopRecording(id));
      },
      cancel: async () => {
        live = null;
        unwrap(await dictation.cancelRecording(id));
      },
      transcribe: async (path, signal) => {
        let text = "";
        await current.current.runBatch(path, {
          signal,
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
      insert: async (target, text) => {
        unwrap(await dictation.insertText(target, text));
      },
      discard: async (path) => {
        unwrap(await dictation.discardRecording(path));
      },
      onJobFinished: async () => {},
      onTranscript: (lastTranscript) => {
        if (!disposed) useDictationStatus.setState({ lastTranscript });
      },
      onError,
      onStatus: (next, outcome) => {
        const previous = status;
        status = next;
        if (!disposed) useDictationStatus.setState(next);
        // A capture shows recording over any pending jobs; once it ends the
        // jobs show processing, and the last one to finish shows how it went.
        if (next.phase !== previous.phase) {
          if (next.phase === "transcribing") hud({ type: "processing" });
          if (next.phase === "idle") {
            hud({ type: outcome });
            hudShown = false;
          }
        }
        // Escape is only taken from other apps while a capture is in progress.
        if (next.capturing === previous.capturing) return;
        presentation = presentation
          .then(async () => {
            try {
              unwrap(await shortcuts.setActive(next.capturing && !disposed));
            } catch (error) {
              onError(error);
            }
          })
          .catch(onError);
      },
    });
    const cancel = () => {
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
          else void controller.cancelCapture();
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
        capturing: false,
        pending: 0,
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
