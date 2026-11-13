import { useCallback } from "react";
import { create } from "zustand";

import { commands as trayCommands } from "@anlg/plugin-tray";
import { commands as windowsCommands } from "@anlg/plugin-windows";

import {
  type NoteTypeSelection,
  setSessionNoteType,
} from "~/note-types/queries";
import { createSessionReportingFolder } from "~/session/queries";
import { folderIdForNewNote, useSidebarNotes } from "~/sidebar/note-filter";
import { listenerStore } from "~/store/zustand/listener/instance";
import { useTabs } from "~/store/zustand/tabs";
import {
  AUTO_START_TIMEOUT_MS,
  onAutoStartSettled,
} from "~/stt/auto-start-events";

export type NewNoteRequest = {
  record: boolean;
  behavior: "new" | "current";
  folderId: string | undefined;
};

export const useNewNoteDialog = create<{
  request: NewNoteRequest | null;
  close: () => void;
}>((set) => ({
  request: null,
  close: () => set({ request: null }),
}));

function requestNewNote({
  record,
  behavior,
}: {
  record: boolean;
  behavior: "new" | "current";
}) {
  useNewNoteDialog.setState({
    request: { record, behavior, folderId: currentFolderId() },
  });
}

function currentFolderId() {
  const { noteFilter, folderFilter } = useSidebarNotes.getState();
  return folderIdForNewNote(noteFilter, folderFilter);
}

export async function createRequestedNote(
  request: NewNoteRequest,
  { title, noteType }: { title: string; noteType: NoteTypeSelection },
) {
  const { sessionId, folderError } =
    request.folderId === undefined
      ? await createSessionReportingFolder(title)
      : await createSessionReportingFolder(title, undefined, {
          folder_id: request.folderId,
        });

  const typeError = noteType.typeId
    ? await setSessionNoteType(sessionId, noteType).then(
        () => null,
        (error: unknown) => error,
      )
    : null;

  if (request.record) {
    openSessionAndListen(sessionId, { behavior: request.behavior });
  } else {
    const { openNew, openCurrent } = useTabs.getState();
    const open = request.behavior === "new" ? openNew : openCurrent;
    open({ type: "sessions", id: sessionId });
  }

  return { sessionId, typeError, folderError };
}

export function useNewNote({
  behavior = "new",
}: {
  behavior?: "new" | "current";
} = {}) {
  return useCallback(
    () => requestNewNote({ record: false, behavior }),
    [behavior],
  );
}

export function useNewNoteAndListen({
  behavior = "new",
}: {
  behavior?: "new" | "current";
} = {}) {
  return useCallback(() => openNewNoteAndListen({ behavior }), [behavior]);
}

export function openNewNote({
  behavior = "new",
}: {
  behavior?: "new" | "current";
} = {}) {
  requestNewNote({ record: false, behavior });
}

export function openNewNoteAndListen({
  behavior = "new",
}: {
  behavior?: "new" | "current";
} = {}) {
  const { status, sessionId: liveSessionId } = listenerStore.getState().live;

  if (status === "active" && liveSessionId) {
    const { openNew, openCurrent } = useTabs.getState();
    const open = behavior === "new" ? openNew : openCurrent;
    open({ type: "sessions", id: liveSessionId });
    return;
  }

  requestNewNote({ record: true, behavior });
}

export function openSessionAndListen(
  sessionId: string,
  {
    behavior = "new",
  }: {
    behavior?: "new" | "current";
  } = {},
) {
  const { openNew, openCurrent } = useTabs.getState();
  const { status } = listenerStore.getState().live;
  const open = behavior === "new" ? openNew : openCurrent;

  if (status === "active") {
    open({ type: "sessions", id: sessionId });
    return;
  }

  open({
    type: "sessions",
    id: sessionId,
    state: { view: null, autoStart: true },
  });
}

// The menu bar's "Start a new meeting" may arrive while the main window is
// hidden, so it records without the dialog; the note is named later.
// `fromClick` is false for the check made when the main window loads, which
// only acts on a click the window could not receive at the time.
export async function takeTrayMeetingStart({
  fromClick,
}: {
  fromClick: boolean;
}) {
  let pending = fromClick;
  try {
    const result = await trayCommands.takePendingTrayStart();
    if (result.status === "error") throw new Error(result.error);
    pending = result.data;
  } catch (error) {
    console.error("[tray] failed to claim the menu bar start", error);
  }
  if (pending) await startMeetingFromTray();
}

let trayMeetingStart: Promise<void> | null = null;

function startMeetingFromTray() {
  trayMeetingStart ??= recordNewMeetingInBackground().finally(() => {
    trayMeetingStart = null;
  });
  return trayMeetingStart;
}

async function recordNewMeetingInBackground() {
  const { tabs, openNew, select } = useTabs.getState();
  const { status, sessionId: liveSessionId } = listenerStore.getState().live;

  if (status === "active" && liveSessionId) {
    openNew({ type: "sessions", id: liveSessionId });
    return;
  }

  const starting = tabs.find(
    (tab) => tab.type === "sessions" && Boolean(tab.state.autoStart),
  );
  if (starting) {
    select(starting);
    return;
  }

  try {
    const { sessionId, folderError } = await createRequestedNote(
      { record: true, behavior: "new", folderId: currentFolderId() },
      { title: "", noteType: { typeId: null, subtypeId: null } },
    );
    if (folderError) {
      console.error("[session] failed to catalog note folder", folderError);
    }
    watchTrayRecording(sessionId);
  } catch (error) {
    console.error("[session] failed to create the menu bar meeting", error);
    requestNewNote({ record: true, behavior: "new" });
    await windowsCommands.windowShow({ type: "main" });
  }
}

// Fires just after SessionAutoStart gives up on a connection that never
// became ready.
export const TRAY_RECORDING_TIMEOUT_MS = AUTO_START_TIMEOUT_MS + 1_000;
// A start that resolved may still be waiting for the native Active event.
const TRAY_RECORDING_SETTLE_GRACE_MS = 3_000;

// Failures to start only show a toast in the window, which is still hidden
// after a menu bar start; bring it forward on the note so they are seen.
function watchTrayRecording(sessionId: string) {
  const isRecording = () => {
    const { status, sessionId: liveSessionId } = listenerStore.getState().live;
    return liveSessionId === sessionId && status !== "inactive";
  };
  if (isRecording()) return;

  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const finish = (failed: boolean) => {
    clearTimeout(timeout);
    clearTimeout(settleTimer);
    unsubscribeListener();
    unsubscribeSettled();
    if (failed) void revealTrayNote(sessionId);
  };
  const check = () => finish(!isRecording());

  const timeout = setTimeout(check, TRAY_RECORDING_TIMEOUT_MS);
  const unsubscribeListener = listenerStore.subscribe(() => {
    if (isRecording()) finish(false);
  });
  const unsubscribeSettled = onAutoStartSettled((settledSessionId) => {
    if (settledSessionId !== sessionId) return;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(check, TRAY_RECORDING_SETTLE_GRACE_MS);
  });
}

async function revealTrayNote(sessionId: string) {
  useTabs.getState().openNew({ type: "sessions", id: sessionId });
  await windowsCommands.windowShow({ type: "main" });
}
