import type { EditorView } from "prosemirror-view";

import { flushDatabaseWrites } from "~/db/write-queue";

const mountedCanonicalEditors = new Map<string, Map<EditorView, () => void>>();

export function registerCanonicalSessionEditor(
  sessionId: string,
  view: EditorView,
  flushPendingChanges: () => void,
) {
  const editors = mountedCanonicalEditors.get(sessionId) ?? new Map();
  editors.set(view, flushPendingChanges);
  mountedCanonicalEditors.set(sessionId, editors);
}

export function unregisterCanonicalSessionEditor(
  sessionId: string,
  view: EditorView,
) {
  const editors = mountedCanonicalEditors.get(sessionId);
  if (!editors) return;
  editors.delete(view);
  if (editors.size === 0) mountedCanonicalEditors.delete(sessionId);
}

export async function flushCanonicalSessionEditorChanges(
  sessionId: string,
): Promise<void> {
  const editors = mountedCanonicalEditors.get(sessionId);
  if (editors) {
    for (const flushPendingChanges of editors.values()) {
      flushPendingChanges();
    }
  }
  await flushDatabaseWrites([`session:${sessionId}`]);
}
