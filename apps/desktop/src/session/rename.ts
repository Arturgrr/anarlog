import { md2json, parseJsonContent } from "@anlg/editor/markdown";

import { executeTransaction } from "~/db";
import { enqueueDatabaseWrite } from "~/db/write-queue";
import { loadPendingAutoEnhanceNote } from "~/services/enhancer/storage";
import { saveSessionTitleWithDocuments } from "~/session/content-mutations";
import { loadSessionContentSnapshot } from "~/session/content-queries";
import { replaceFirstLineTitle } from "~/session/title-content";

// Summaries open with the title as their H1; renaming must move that line too,
// or the summary editor would prepend the new title above the old one.
export function renameSession(sessionId: string, title: string) {
  return enqueueDatabaseWrite(`session:${sessionId}`, async () => {
    const snapshot = await loadSessionContentSnapshot(sessionId, {
      includeTranscriptWords: false,
    });
    if (!snapshot) return saveTitle(sessionId, title);

    // A summary awaiting regeneration is saved against the body recorded when
    // it started; rewriting that body would make the save fail. The
    // regenerated summary is composed with the title current at that point.
    const pending = await loadPendingAutoEnhanceNote(sessionId);
    const documents = snapshot.enhancedNotes
      .filter((note) => note.content.trim())
      .filter(
        (note) => note.id !== pending?.noteId || note.content !== pending.body,
      )
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

    if (documents.length > 0) {
      try {
        return await saveSessionTitleWithDocuments({
          sessionId,
          currentTitle: snapshot.title,
          nextTitle: title,
          documents,
        });
      } catch (error) {
        console.warn("[rename] kept summary headings unchanged", error);
      }
    }

    return saveTitle(sessionId, title);
  });
}

async function saveTitle(sessionId: string, title: string) {
  await executeTransaction([
    {
      sql: `
        UPDATE sessions
        SET title = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `,
      params: [title, new Date().toISOString(), sessionId],
    },
  ]);
}
