import { useCallback } from "react";
import { create } from "zustand";

import {
  type NoteTypeSelection,
  setSessionNoteType,
} from "~/note-types/queries";
import { createSession } from "~/session/queries";
import { folderIdForNewNote, useSidebarNotes } from "~/sidebar/note-filter";
import { listenerStore } from "~/store/zustand/listener/instance";
import { useTabs } from "~/store/zustand/tabs";

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
  const { noteFilter, folderFilter } = useSidebarNotes.getState();
  useNewNoteDialog.setState({
    request: {
      record,
      behavior,
      folderId: folderIdForNewNote(noteFilter, folderFilter),
    },
  });
}

export async function createRequestedNote(
  request: NewNoteRequest,
  { title, noteType }: { title: string; noteType: NoteTypeSelection },
) {
  const sessionId =
    request.folderId === undefined
      ? await createSession(title)
      : await createSession(title, undefined, { folder_id: request.folderId });

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

  return { sessionId, typeError };
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
