import { create } from "zustand";

import {
  type NoteTypeSelection,
  setSessionNoteType,
} from "~/note-types/queries";
import { renameSession } from "~/session/rename";
import {
  hasLiveSessionTitleDraft,
  useLiveTitle,
} from "~/store/zustand/live-title";

export type EditNoteRequest = {
  sessionId: string;
  storeTitle: string;
  title: string;
};

export const useEditNoteDialog = create<{
  request: EditNoteRequest | null;
  close: () => void;
}>((set) => ({
  request: null,
  close: () => set({ request: null }),
}));

export function openEditNote({
  sessionId,
  storeTitle,
}: {
  sessionId: string;
  storeTitle: string;
}) {
  const title = hasLiveSessionTitleDraft(sessionId)
    ? useLiveTitle.getState().titles[sessionId].value
    : storeTitle;
  useEditNoteDialog.setState({ request: { sessionId, storeTitle, title } });
}

export async function saveNoteDetails(
  request: EditNoteRequest,
  initialNoteType: NoteTypeSelection,
  next: { title: string; noteType: NoteTypeSelection },
) {
  if (next.title !== request.title.trim()) {
    await renameSession(request.sessionId, next.title);
    const { setTitle, markTitlePersisted } = useLiveTitle.getState();
    setTitle(request.sessionId, next.title);
    markTitlePersisted(request.sessionId, next.title, request.storeTitle);
  }

  if (!sameNoteType(initialNoteType, next.noteType)) {
    await setSessionNoteType(request.sessionId, next.noteType);
  }
}

function sameNoteType(a: NoteTypeSelection, b: NoteTypeSelection) {
  return (
    (a.typeId ?? null) === (b.typeId ?? null) &&
    (a.typeId ? (a.subtypeId ?? null) : null) ===
      (b.typeId ? (b.subtypeId ?? null) : null)
  );
}
