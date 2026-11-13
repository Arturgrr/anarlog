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
  /** Takes Escape from other apps while ink is on. */
  setEscape: (enabled: boolean) => Promise<void>;
  notify: {
    ready: (finalized: Finalized) => void;
    screenRecordingDenied: () => void;
    needsRestart: () => void;
    microphoneDenied: () => void;
    transcriptionFailed: (error: unknown) => void;
    nothingToPaste: () => void;
    error: (error: unknown) => void;
  };
  onPhase: (phase: AnnotatePhase) => void;
};

/** Hex pauses this long between the image path and the text. */
export const PASTE_GAP_MS = 160;

const NOT_RECORDING = "No annotation is recording.";

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One annotation at a time, driven by the shortcut, the capsule's events
 * and the plugin's status. Every failure ends back at idle.
 */
export function createAnnotateFlow(deps: AnnotateDeps) {
  let phase: AnnotatePhase = "idle";
  // The stopped recording being transcribed and finalized.
  let finishing: string | null = null;

  const set = (next: AnnotatePhase) => {
    phase = next;
    deps.onPhase(next);
  };
  const quietly = (work: Promise<unknown>) =>
    work.catch((error) => console.error("[annotate]", error));

  const toIdle = () => {
    finishing = null;
    set("idle");
    void quietly(deps.setRecording(false));
    void quietly(deps.setEscape(false));
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
      deps.notify.error(error);
      await recover();
    }
  }

  async function finish(stopped: Stopped) {
    if (finishing === stopped.id) return;
    finishing = stopped.id;
    set("transcribing");
    void quietly(deps.setRecording(false));
    void quietly(deps.setEscape(false));
    let transcript: TranscriptInput | null = null;
    if (stopped.audioPath) {
      try {
        transcript = await deps.transcribe(stopped.audioPath);
      } catch (error) {
        // The bundle is still worth having: frames and ink, without words.
        deps.notify.transcriptionFailed(error);
      }
    }
    try {
      const finalized = await deps.plugin.finalize(stopped.id, transcript);
      await quietly(deps.copy(finalized.summary));
      deps.notify.ready(finalized);
    } catch (error) {
      deps.notify.error(error);
    } finally {
      toIdle();
    }
  }

  async function stop() {
    if (phase !== "recording") return;
    set("finishing");
    let stopped: Stopped;
    try {
      stopped = await deps.plugin.stop();
    } catch (error) {
      // The capsule's stop got there first; its event finishes it.
      if (messageOf(error) === NOT_RECORDING) return;
      deps.notify.error(error);
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
        return quietly(deps.setEscape(event.on));
      case "failed":
        deps.notify.error(new Error(event.message));
        return recover();
    }
  }

  async function ink(on: boolean) {
    if (phase !== "recording") return;
    await quietly(deps.plugin.setInkMode(on ? "hover" : "off"));
    await quietly(deps.setEscape(on));
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
    await deps.insert(finalized.contactSheet);
    await deps.sleep(PASTE_GAP_MS);
    await deps.insert(finalized.summary);
  }

  async function discard() {
    try {
      await deps.plugin.cancel();
    } catch (error) {
      deps.notify.error(error);
    }
    await recover();
  }

  return {
    start,
    stop,
    recover,
    onEvent,
    onShortcut,
    pasteLast,
    paste,
    discard,
    get phase() {
      return phase;
    },
  };
}
