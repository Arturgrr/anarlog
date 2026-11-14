import type {
  AnnotateEvent,
  Finalized,
  Started,
  Status,
  Stopped,
  TranscriptInput,
} from "@anlg/plugin-annotate";

export type AnnotatePhase =
  | "idle"
  | "starting"
  | "recording"
  | "finishing"
  | "transcribing";

/** What the flow needs from the app; each throws on failure. */
export type AnnotateDeps = {
  plugin: {
    status: () => Promise<Status>;
    screenRecording: () => Promise<string>;
    requestScreenRecording: () => Promise<boolean>;
    start: () => Promise<Started>;
    stop: () => Promise<Stopped>;
    finalize: (
      id: string,
      transcript: TranscriptInput | null,
    ) => Promise<Finalized>;
    cancel: () => Promise<void>;
    setInkMode: (mode: "off" | "hover") => Promise<void>;
    latest: () => Promise<Finalized | null>;
  };
  microphoneAuthorized: () => Promise<boolean>;
  /** The narration's words, or null when nothing was heard. */
  transcribe: (audioPath: string) => Promise<TranscriptInput | null>;
  copy: (text: string) => Promise<void>;
  /** Pastes into the frontmost app. */
  insert: (text: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  /** Tells the shortcut whether a recording runs. */
  setRecording: (recording: boolean) => Promise<void>;
  notify: {
    ready: (finalized: Finalized) => void;
    screenRecordingDenied: () => void;
    needsRestart: () => void;
    microphoneDenied: () => void;
    transcriptionFailed: (error: unknown) => void;
    /** The narration waits for another recording's local transcription. */
    transcriptionWaiting: () => void;
    nothingToPaste: () => void;
    error: (error: unknown) => void;
  };
  onPhase: (phase: AnnotatePhase) => void;
};

/** Hex pauses this long between the image path and the text. */
export const PASTE_GAP_MS = 160;

const NOT_RECORDING = "No annotation is recording.";
const CANCELLED = "The annotation was cancelled.";
/** Batch transcription's answer for audio without speech. */
export const NO_SPEECH = "No speech was detected in the audio.";
/**
 * The local model server's answer once it has kept the narration waiting
 * for another recording's transcription, such as a meeting's that just
 * stopped.
 */
export const TRANSCRIPTION_BUSY =
  "Local transcription is busy with another recording. Try again when it finishes.";
/** Each try already waits about 30 s at the server: a few minutes in all. */
export const BUSY_RETRY_MS = 15_000;
const BUSY_RETRIES = 6;

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A path as Terminal's drag and drop types it: spaces and the shell's
 * special characters behind a backslash, which terminal agents such as
 * Claude Code read as one path to attach.
 */
export function shellEscapePath(path: string) {
  return path.replace(/[\s!"#$&'()*,;<=>?[\\\]^`{|}~]/gu, "\\$&");
}

/**
 * The microphone a narration records: the one a meeting is recording, so
 * both hear the same voice even when the meeting fell back to another input
 * or replaced a Bluetooth default with a wired one; otherwise the chosen one.
 */
export async function narrationMicrophone(
  meeting: () => Promise<string | null>,
  chosen: string | null,
) {
  const recording = await meeting().catch(() => null);
  return recording ?? chosen;
}

/**
 * One annotation at a time, driven by the shortcut, the capsule's events
 * and the plugin's status. Every failure ends back at idle.
 */
export function createAnnotateFlow(deps: AnnotateDeps) {
  let phase: AnnotatePhase = "idle";
  // The stopped recording being transcribed and finalized.
  let finishing: string | null = null;
  // A stop pressed while the recording was still starting.
  let stopWhenStarted = false;
  // The transcript of a recording whose finalize is retried once.
  let heard: { id: string; transcript: TranscriptInput | null } | null = null;

  const set = (next: AnnotatePhase) => {
    phase = next;
    deps.onPhase(next);
  };
  const quietly = (work: Promise<unknown>) =>
    work.catch((error) => console.error("[annotate]", error));

  const toIdle = () => {
    finishing = null;
    stopWhenStarted = false;
    set("idle");
    void quietly(deps.setRecording(false));
  };

  async function screenRecordingAllowed() {
    let access = await deps.plugin.screenRecording();
    if (access === "not_determined") {
      await deps.plugin.requestScreenRecording();
      access = await deps.plugin.screenRecording();
    }
    if (access === "granted") return true;
    if (access === "needs_restart") deps.notify.needsRestart();
    else deps.notify.screenRecordingDenied();
    return false;
  }

  async function start() {
    if (phase !== "idle") {
      // The shortcut took this press for a start; it is not one.
      void quietly(deps.setRecording(phase === "recording"));
      return;
    }
    set("starting");
    try {
      if (!(await screenRecordingAllowed())) return toIdle();
      if (!(await deps.microphoneAuthorized())) {
        deps.notify.microphoneDenied();
        return toIdle();
      }
      await deps.plugin.start();
      set("recording");
      await quietly(deps.setRecording(true));
    } catch (error) {
      if (messageOf(error) !== CANCELLED) deps.notify.error(error);
      await recover();
      return;
    }
    if (stopWhenStarted) {
      stopWhenStarted = false;
      await stop();
    }
  }

  async function transcribe(stopped: Stopped) {
    if (heard?.id === stopped.id) return heard.transcript;
    let transcript: TranscriptInput | null = null;
    for (let busy = 0; stopped.audioPath; busy++) {
      try {
        transcript = await deps.transcribe(stopped.audioPath);
        break;
      } catch (error) {
        const message = messageOf(error);
        if (message.includes(TRANSCRIPTION_BUSY) && busy < BUSY_RETRIES) {
          if (busy === 0) deps.notify.transcriptionWaiting();
          await deps.sleep(BUSY_RETRY_MS);
          continue;
        }
        // The bundle is still worth having: frames and ink, without words.
        if (message !== NO_SPEECH) deps.notify.transcriptionFailed(error);
        break;
      }
    }
    heard = { id: stopped.id, transcript };
    return transcript;
  }

  async function finish(stopped: Stopped) {
    if (finishing === stopped.id) return;
    finishing = stopped.id;
    set("transcribing");
    void quietly(deps.setRecording(false));
    const transcript = await transcribe(stopped);
    try {
      const finalized = await deps.plugin.finalize(stopped.id, transcript);
      heard = null;
      await quietly(deps.copy(finalized.summary));
      deps.notify.ready(finalized);
      toIdle();
    } catch (error) {
      if (messageOf(error) === CANCELLED) return toIdle();
      // The plugin keeps a recording whose finalize failed for one retry.
      finishing = null;
      const status = await deps.plugin.status().catch(() => null);
      if (status?.phase === "finishing" && status.stopped?.id === stopped.id) {
        console.error("[annotate] finalize, retrying", error);
        return finish(status.stopped);
      }
      heard = null;
      deps.notify.error(error);
      toIdle();
    }
  }

  async function stop() {
    if (phase === "starting") {
      stopWhenStarted = true;
      return;
    }
    if (phase !== "recording") return;
    set("finishing");
    let stopped: Stopped;
    try {
      stopped = await deps.plugin.stop();
    } catch (error) {
      const message = messageOf(error);
      if (message !== NOT_RECORDING && message !== CANCELLED) {
        deps.notify.error(error);
      }
      // The capsule's stop or discard got there first: the plugin knows
      // where it stands.
      return recover();
    }
    await finish(stopped);
  }

  /** Puts the flow where the plugin says the session is. */
  async function recover() {
    try {
      const status = await deps.plugin.status();
      if (status.phase === "recording") {
        set("recording");
        await quietly(deps.setRecording(true));
      } else if (status.phase === "finishing" && status.stopped) {
        await finish(status.stopped);
      } else if (status.phase === "idle") {
        toIdle();
      }
    } catch (error) {
      console.error("[annotate] status", error);
      toIdle();
    }
  }

  async function onEvent(event: AnnotateEvent) {
    switch (event.type) {
      case "stopped":
        return finish(event.stopped);
      case "discarded":
        return toIdle();
      case "ink":
        return;
      case "failed":
        deps.notify.error(new Error(event.message));
        return recover();
    }
  }

  async function ink(on: boolean) {
    if (phase !== "recording") return;
    await quietly(deps.plugin.setInkMode(on ? "hover" : "off"));
  }

  async function onShortcut(
    type: "start" | "stop" | "inkOn" | "inkOff" | "escape",
  ) {
    switch (type) {
      case "start":
        return start();
      case "stop":
        return stop();
      case "inkOn":
        return ink(true);
      case "inkOff":
      case "escape":
        return ink(false);
    }
  }

  /** The newest annotation into the frontmost app: its image's path, then its text. */
  async function pasteLast() {
    try {
      const latest = await deps.plugin.latest();
      if (!latest) return deps.notify.nothingToPaste();
      await paste(latest);
    } catch (error) {
      deps.notify.error(error);
    }
  }

  async function paste(finalized: Finalized) {
    await deps.insert(shellEscapePath(finalized.contactSheet));
    await deps.sleep(PASTE_GAP_MS);
    await deps.insert(finalized.summary);
  }

  return {
    start,
    stop,
    recover,
    onEvent,
    onShortcut,
    pasteLast,
    paste,
    get phase() {
      return phase;
    },
  };
}
