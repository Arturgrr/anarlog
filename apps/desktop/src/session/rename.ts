import { md2json, parseJsonContent } from "@anlg/editor/markdown";

import { applyGeneratedSessionTitle } from "~/session/content-mutations";
import { loadSessionContentSnapshot } from "~/session/content-queries";
import { updateSession } from "~/session/queries";
import { replaceFirstLineTitle } from "~/session/title-content";

// Summaries open with the title as their H1; renaming must move that line too,
// or the summary editor would prepend the new title above the old one.
export async function renameSession(sessionId: string, title: string) {
  const snapshot = await loadSessionContentSnapshot(sessionId);
  if (!snapshot) return updateSession(sessionId, { title });

  const documents = snapshot.enhancedNotes
    .filter((note) => note.content.trim())
    .flatMap((note) => {
      const parsed =
        note.contentFormat === "markdown"
          ? md2json(note.content)
          : parseJsonContent(note.content);
      const next = replaceFirstLineTitle(parsed, snapshot.title, title);
      return next
        ? [
            {
              id: note.id,
              currentContent: note.content,
              currentContentFormat: note.contentFormat,
              nextContent: JSON.stringify(next),
            },
          ]
        : [];
    });

  if (documents.length === 0) return updateSession(sessionId, { title });

  return applyGeneratedSessionTitle({
    sessionId,
    currentTitle: snapshot.title,
    nextTitle: title,
    documents,
  });
}
