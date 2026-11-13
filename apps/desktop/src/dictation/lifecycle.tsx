import { t } from "@lingui/core/macro";
import { Channel } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { useRef, useState } from "react";

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

import { keepOnClipboard } from "./clipboard";
import { DictationController } from "./controller";
import {
  dictationAudioBehaviors,
  recordingEnvironmentConfig,
} from "./environment";
import { recordDictation } from "./history/store";
import { normalizeHudPosition } from "./hud-position";
import { useDictationStatus } from "./state";

import { localizeExternalMessage } from "~/i18n/external-messages";
import { useSettingsReady } from "~/settings/queries";
import { isAppStoreBuild } from "~/shared/app-store";
import { useConfigValue } from "~/shared/config";
import { useListener } from "~/stt/contexts";
import { useRunBatch } from "~/stt/useRunBatch";
import { useSTTConnection } from "~/stt/useSTTConnection";
export { useDictationStatus } from "./state";

let lifecycle: Promise<void> = Promise.resolve();

// How long the start cue sounds once asked for, opening its output included.
// Muting or lowering other audio waits for it, so the cue is heard, unless
// the last dictation left other audio quiet: it then stays quiet throughout.
const START_CUE_MS = 400;

export function waitForDictationCleanup() {
  return lifecycle;
}

export function DictationLifecycle() {
  const settingsReady = useSettingsReady();
  const enabled = useConfigValue("dictation_enabled");

  if (!settingsReady || !enabled) return null;
  return (
    <TranscriptRetention>
      <ActiveDictation />
    </TranscriptRetention>
  );
}

/** What the registered shortcuts drive; it outlives their registration. */
type Dictation = {
  onShortcut: (type: string) => void;
  /** Cancels the capture in progress; resolves once it let go of the recorder and Escape. */
  stopCapture: () => Promise<void>;
  onError: (error: unknown) => void;
};

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

// Dictations already accepted outlive a change of shortcuts or hands-free, a
// retry and a shortcut being recorded: only turning dictation off, or Cancel,
// drops them.
function ActiveDictation() {
  const configured = useConfigValue("dictation_shortcuts");
  const handsFree = useConfigValue("dictation_hands_free");
  const capturingShortcut = useDictationStatus(
    (state) => state.capturingShortcut,
  );
  const retry = useDictationStatus((state) => state.retry);
  const [session, setSession] = useState<Dictation | null>(null);
  const id = useRef(`system-dictation-${crypto.randomUUID()}`).current;
  const runBatch = useRunBatch(id);
  const stopTranscription = useListener((state) => state.stopTranscription);
  const microphone = useConfigValue("microphone_device");
  const livePreview = useConfigValue("dictation_live_preview");
  const dictionary = useConfigValue("personalization_dictionary_terms");
  const languages = useConfigValue("spoken_languages");
  const sounds = useConfigValue("dictation_sounds");
  const hudPosition = useConfigValue("dictation_hud_position");
  const audio = {
    behavior: useConfigValue("dictation_audio_behavior"),
    duckVolume: useConfigValue("dictation_audio_duck_volume"),
    pauseBrowser: useConfigValue("dictation_audio_pause_browser"),
  };
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
    hudPosition,
    audio,
    meetingActive,
    conn,
    handsFree,
  });
  current.current = {
    runBatch,
    microphone,
    livePreview,
    languages,
    dictionary,
    sounds,
    hudPosition,
    audio,
    meetingActive,
    conn,
    handsFree,
  };

  useMountEffect(() => {
    let disposed = false;
    let presentation: Promise<void> = Promise.resolve();
    let status = { phase: "idle", capturing: false, pending: 0 };
    // The capture whose live words the HUD shows, and what makes them.
    let live: {
      stopped: boolean;
      preview: {
        provider: string;
        model: string;
        language: string | null;
      } | null;
    } | null = null;
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
    // Resolves whether it played.
    const cue = async (sound: AppSounds) => {
      const { sounds, meetingActive } = current.current;
      if (disposed || !sounds || meetingActive) return false;
      try {
        const capture = unwrap(await transcription.getCaptureState());
        if (capture !== "inactive") return false;
        await sfx.play(sound);
        return true;
      } catch (error) {
        console.error(error);
        return false;
      }
    };
    const frontmostApp = async () => {
      const app = await dictation.frontmostApp();
      return app.status === "ok" ? app.data : null;
    };
    const meetingRecording = async () => {
      if (current.current.meetingActive) return true;
      const capture = await transcription.getCaptureState();
      return capture.status === "error" || capture.data !== "inactive";
    };
    const controller = new DictationController({
      // Read at each press: the controller outlives a change of the setting.
      get handsFree() {
        return current.current.handsFree;
      },
      start: async (signal) => {
        // First, while the app being dictated into is still in front.
        const app = frontmostApp().catch(() => null);
        const {
          microphone,
          livePreview,
          conn,
          languages,
          dictionary,
          audio,
          hudPosition,
        } = current.current;
        useDictationStatus.setState({ error: null });
        const meeting = meetingRecording().catch(() => true);
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
        const cueEnds = Date.now() + START_CUE_MS;
        const started = cue("StartRecording");
        unwrap(await dictation.checkInsertion());
        // A self-hosted server may take one live connection at a time: a
        // second one would cut off the meeting's transcript, or contend with
        // an earlier dictation still finishing or transcribing there. This
        // dictation is then transcribed when its turn comes.
        const preview =
          conn &&
          !(
            isLocalServer(conn.baseUrl) &&
            (status.pending > 0 || (await meeting))
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
        // Muting or pausing would silence the call a meeting records.
        const environment = (await meeting)
          ? null
          : {
              config: recordingEnvironmentConfig({
                ...audio,
                available: dictationAudioBehaviors({
                  os: platform(),
                  appStore: isAppStoreBuild(),
                }),
              }),
              delayMs: (await started) ? Math.max(0, cueEnds - Date.now()) : 0,
            };
        signal.throwIfAborted();
        // The HUD is on screen before the microphone opens. It is only a cue:
        // when it can't show, the dictation goes on without it.
        const shown = await sendHud({
          type: "started",
          position: normalizeHudPosition(hudPosition, platform()),
        });
        if (shown.status === "ok") hudShown = true;
        else console.error("Dictation indicator could not show:", shown.error);
        signal.throwIfAborted();
        const capture = {
          stopped: false,
          preview: conn &&
            preview && {
              provider: conn.provider,
              model: conn.model,
              language: (languages || []).join(",") || null,
            },
        };
        live = capture;
        unwrap(
          await dictation.startSystemRecording(
            microphone || null,
            id,
            preview,
            new Channel<RecordingUpdate>((update) => {
              if (update.type === "ended") {
                if (capture.stopped) void cue("StopRecording");
                return;
              }
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
            environment,
          ),
        );
        return { app };
      },
      stop: async () => {
        const capture = live;
        live = null;
        // The stop cue plays once the recording has ended and any audio it
        // quieted is back.
        if (capture) capture.stopped = true;
        const recorded = unwrap(await dictation.stopRecording(id));
        return {
          filePath: recorded.filePath,
          durationMs: recorded.durationMs,
          transcript:
            recorded.transcript != null && capture?.preview
              ? { text: recorded.transcript, ...capture.preview }
              : null,
        };
      },
      cancel: async () => {
        live = null;
        unwrap(await dictation.cancelRecording(id));
      },
      transcribe: async (path, signal) => {
        let text = "";
        const used = await current.current.runBatch(path, {
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
        return {
          text,
          provider: used.provider,
          model: used.model,
          language: used.languages.join(",") || null,
        };
      },
      insert: async (text) => {
        try {
          unwrap(await dictation.insertText(text));
        } finally {
          await keepOnClipboard(text).catch(console.error);
        }
      },
      discard: async (path) => {
        unwrap(await dictation.discardRecording(path));
      },
      onJobFinished: async (job) => {
        if (job.cancelled) return { claimedAudio: false };
        try {
          const { audioKept } = await recordDictation({
            id: job.id,
            createdAt: job.createdAt,
            durationMs: job.durationMs,
            targetApp: await job.context.app,
            provider: job.provider,
            model: job.model,
            language: job.language,
            rawText: job.rawText,
            finalText: job.finalText,
            inserted: job.inserted,
            audioPath: job.audioPath,
          });
          return { claimedAudio: audioKept };
        } catch (error) {
          console.error("[dictation] history", error);
          throw new Error(t`Could not save this dictation to your history.`);
        }
      },
      onTranscript: (lastTranscript) => {
        if (!disposed) useDictationStatus.setState({ lastTranscript });
      },
      // A shortcut being recorded in Settings would take the paste's keys,
      // and the text would land in Settings.
      insertionPaused: (signal) => {
        if (!useDictationStatus.getState().capturingShortcut) return null;
        return new Promise<void>((resolve) => {
          const done = () => {
            unsubscribe();
            signal.removeEventListener("abort", done);
            resolve();
          };
          const unsubscribe = useDictationStatus.subscribe((state) => {
            if (!state.capturingShortcut) done();
          });
          signal.addEventListener("abort", done);
          if (signal.aborted) done();
        });
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
    useDictationStatus.setState({ cancel });
    setSession({
      onShortcut: (type) => {
        if (type === "pressed") controller.press();
        else if (type === "released") controller.release();
        else void controller.cancelCapture();
      },
      stopCapture: async () => {
        await controller.cancelCapture();
        await presentation;
      },
      onError,
    });

    return () => {
      disposed = true;
      cancel();
      useDictationStatus.setState({
        ready: false,
        phase: "idle",
        capturing: false,
        pending: 0,
        cancel: null,
      });
      lifecycle = lifecycle
        .then(async () => {
          await controller.cancel();
          await presentation;
        })
        .catch(() => {});
    };
  });

  if (!session || capturingShortcut) return null;
  return (
    <ShortcutRegistration
      key={`${JSON.stringify(configured)}:${handsFree}:${retry}`}
      shortcuts={configured}
      dictation={session}
    />
  );
}

// Registered again whenever the shortcuts, hands-free or a retry change, and
// released while a shortcut is recorded. The next registration waits until
// this one's capture has let go of the recorder.
function ShortcutRegistration({
  shortcuts: configured,
  dictation: { onShortcut, stopCapture, onError },
}: {
  shortcuts: string[];
  dictation: Dictation;
}) {
  useMountEffect(() => {
    let disposed = false;
    let armed = false;
    let unlisten: (() => void) | undefined;

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
          onShortcut(payload.type);
        });
        if (disposed) {
          unlisten();
          return;
        }
        unwrap(await shortcuts.configure(configured));
        armed = !disposed;
        if (!disposed)
          useDictationStatus.setState({ ready: true, error: null });
      })
      .catch(onError);

    return () => {
      disposed = true;
      armed = false;
      unlisten?.();
      useDictationStatus.setState({ ready: false });
      const stopped = stopCapture();
      lifecycle = lifecycle
        .then(async () => {
          unlisten?.();
          await stopped;
          unwrap(await shortcuts.configure([]));
        })
        .catch(() => {});
    };
  });
  return null;
}
