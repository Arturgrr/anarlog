import type {
  CaptureEntry,
  CaptureEvent,
  CaptureLabels,
  CaptureOutcome,
  CaptureStatus,
  RecordingOutput,
  RecordingRequest,
  RecordingStart,
  ScreenshotRequest,
} from "@anlg/plugin-capture";
import type { CaptureAction } from "@anlg/plugin-shortcut";

export type CapturePhase = CaptureStatus["phase"];

/** The settings a capture request is built from. */
export type CaptureSettings = {
  copy: boolean;
  saveToFolder: boolean;
  /** Empty is the user's Downloads. */
  folder: string;
  showCard: boolean;
  openEditor: boolean;
  imageFormat: string;
  showCursor: boolean;
  recordFps: number;
  recordCursor: boolean;
  microphone: boolean;
  systemAudio: boolean;
  countdown: number;
  gifFps: number;
  gifMaxWidth: number;
};

/** What the flow needs from the app; each throws on failure. */
export type CaptureDeps = {
  plugin: {
    status: () => Promise<CaptureStatus>;
    screenRecording: () => Promise<string>;
    requestScreenRecording: () => Promise<boolean>;
    screenshot: (request: ScreenshotRequest) => Promise<CaptureOutcome>;
    startRecording: (request: RecordingRequest) => Promise<RecordingStart>;
    stopRecording: () => Promise<CaptureOutcome>;
    cancelRecording: () => Promise<void>;
    listCaptures: () => Promise<CaptureEntry[]>;
  };
  settings: () => CaptureSettings;
  labels: (kind: "screenshot" | "recording") => CaptureLabels;
  microphoneAuthorized: () => Promise<boolean>;
  /** Whether a Librelog window is in front. */
  frontmost: () => Promise<boolean>;
  openEditor: (id: string) => Promise<void>;
  openFile: (path: string) => Promise<void>;
  notify: {
    /** A capture finished while no card shows it and Librelog is in front. */
    captured: (entry: CaptureEntry, copied: boolean) => void;
    screenRecordingDenied: () => void;
    needsRestart: () => void;
    microphoneDenied: () => void;
    error: (error: unknown) => void;
  };
  onPhase: (phase: CapturePhase) => void;
};

/** The plugin's answer while a selector or recording is already up. */
export const BUSY = "A capture is already running.";
const NOT_RECORDING = "No recording is running.";

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const MODES = {
  area: "area",
  fullscreen: "fullscreen",
  window: "window",
} as const;

export function screenshotRequest(
  mode: ScreenshotRequest["mode"],
  settings: CaptureSettings,
  labels: CaptureLabels,
): ScreenshotRequest {
  return {
    mode,
    format: settings.imageFormat === "jpeg" ? "jpeg" : "png",
    showCursor: settings.showCursor,
    copy: settings.copy,
    saveDir: settings.saveToFolder ? settings.folder : null,
    folder: settings.folder || null,
    showCard: settings.showCard,
    labels,
  };
}

export function recordingRequest(
  output: RecordingOutput,
  settings: CaptureSettings,
  labels: CaptureLabels,
): RecordingRequest {
  return {
    mode: "area",
    output,
    fps: settings.recordFps === 60 ? 60 : 30,
    showCursor: settings.recordCursor,
    microphone: settings.microphone,
    systemAudio: settings.systemAudio,
    countdownS: settings.countdown === 3 ? 3 : 0,
    gifFps: settings.gifFps,
    gifMaxWidth: settings.gifMaxWidth,
    copy: settings.copy,
    saveDir: settings.saveToFolder ? settings.folder : null,
    folder: settings.folder || null,
    showCard: settings.showCard,
    labels,
  };
}

/**
 * One capture at a time, driven by the shortcuts, the plugin's events and
 * its status. Every failure ends where the plugin says it stands.
 */
export function createCaptureFlow(deps: CaptureDeps) {
  let phase: CapturePhase = "idle";
  // A recording's selector or countdown is up: `startRecording` has not
  // resolved yet.
  let recordingSelector = false;

  // Read through a call: events change the phase while a command awaits.
  const now = () => phase;
  const set = (next: CapturePhase) => {
    phase = next;
    deps.onPhase(next);
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

  /** Reports a failure (but not a press the plugin was too busy for) and resyncs. */
  async function failed(error: unknown) {
    const message = messageOf(error);
    if (message !== BUSY && message !== NOT_RECORDING) deps.notify.error(error);
    await recover();
  }

  async function screenshot(mode: ScreenshotRequest["mode"]) {
    if (phase !== "idle") return;
    set("selecting");
    try {
      if (!(await screenRecordingAllowed())) return set("idle");
      await deps.plugin.screenshot(
        screenshotRequest(mode, deps.settings(), deps.labels("screenshot")),
      );
      // `captured` arrives as an event.
      if (now() === "selecting") set("idle");
    } catch (error) {
      await failed(error);
    }
  }

  async function startRecording(output: RecordingOutput) {
    set("selecting");
    try {
      if (!(await screenRecordingAllowed())) return set("idle");
      const settings = deps.settings();
      if (settings.microphone && !(await deps.microphoneAuthorized())) {
        deps.notify.microphoneDenied();
        return set("idle");
      }
      recordingSelector = true;
      const started = await deps.plugin
        .startRecording(
          recordingRequest(output, settings, deps.labels("recording")),
        )
        .finally(() => (recordingSelector = false));
      set(started.status === "recording" ? "recording" : "idle");
    } catch (error) {
      await failed(error);
    }
  }

  async function cancelRecording() {
    try {
      await deps.plugin.cancelRecording();
    } catch (error) {
      await failed(error);
    }
  }

  async function stopRecording() {
    set("finishing");
    try {
      await deps.plugin.stopRecording();
      // `captured` arrives as an event.
      if (now() === "finishing") set("idle");
    } catch (error) {
      await failed(error);
    }
  }

  async function record(output: RecordingOutput) {
    if (phase === "recording") return stopRecording();
    if (phase === "idle") return startRecording(output);
    // Pressed again over its own selector or countdown: never mind.
    if (recordingSelector) return cancelRecording();
    // A screenshot's selector or a recording being finished: wait for it.
  }

  async function onShortcut(action: CaptureAction) {
    switch (action) {
      case "area":
      case "fullscreen":
      case "window":
        return screenshot(MODES[action]);
      case "record":
        return record("mp4");
      case "gif":
        return record("gif");
    }
  }

  /** Puts the flow where the plugin says the capture is. */
  async function recover() {
    try {
      set((await deps.plugin.status()).phase);
    } catch (error) {
      console.error("[capture] status", error);
      set("idle");
    }
  }

  async function captured(entry: CaptureEntry) {
    // The plugin is done with it, whether or not its command has returned.
    set("idle");
    const settings = deps.settings();
    if (settings.openEditor && entry.kind === "screenshot") {
      await deps.openEditor(entry.id);
      return;
    }
    if (!settings.showCard && (await deps.frontmost())) {
      deps.notify.captured(entry, settings.copy);
    }
  }

  async function cardAction(id: string, action: "edit" | "open") {
    if (action === "edit") return deps.openEditor(id);
    const entry = (await deps.plugin.listCaptures()).find(
      (candidate) => candidate.id === id,
    );
    if (entry) await deps.openFile(entry.path);
  }

  async function onEvent(event: CaptureEvent) {
    try {
      switch (event.type) {
        case "captured":
          return await captured(event.entry);
        case "recordingStarted":
          return set("recording");
        case "recordingStopped":
          return set(event.reason === "discarded" ? "idle" : "finishing");
        case "failed":
          return await failed(new Error(event.message));
        case "cardAction":
          return await cardAction(event.id, event.action);
      }
    } catch (error) {
      deps.notify.error(error);
    }
  }

  return {
    onShortcut,
    onEvent,
    recover,
    get phase() {
      return phase;
    },
  };
}
