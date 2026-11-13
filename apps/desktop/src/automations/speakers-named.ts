import { executeTransaction, liveQueryClient } from "~/db";
import { enqueueDatabaseWrite } from "~/db/write-queue";

const RAN_WORKFLOWS_PATH = "$.speakers_named_workflow_ids";

// stt/queries calls this after every speaker assignment, and
// stt/session-speakers imports stt/queries, so it and the engine load lazily
// to keep the static import graph acyclic.
export function emitSpeakersNamedIfComplete(
  target: { sessionId: string } | { transcriptId: string },
): Promise<void> {
  return (async () => {
    const sessionId =
      "sessionId" in target
        ? target.sessionId
        : await findTranscriptSessionId(target.transcriptId);
    if (!sessionId || (await isCaptureInProgress(sessionId))) {
      return;
    }
    const { areAllSpeakersNamed, getSessionSpeakers } =
      await import("~/stt/session-speakers");
    if (!areAllSpeakersNamed(await getSessionSpeakers(sessionId))) {
      return;
    }
    const { runSpeakersNamedAutomations } = await import("./engine");
    await runSpeakersNamedAutomations(sessionId);
  })().catch((error) => {
    console.error("[automations] speakers.named check failed", error);
  });
}

// The transcript is still growing while a note is recorded or processed after
// the stop. The listener store only knows captures this window runs; the
// capture lifecycle marker covers captures run by another window.
async function isCaptureInProgress(sessionId: string): Promise<boolean> {
  const [{ listenerStore }, { loadCaptureLifecycleMarker }] = await Promise.all(
    [
      import("~/store/zustand/listener/instance"),
      import("~/stt/capture-lifecycle-storage"),
    ],
  );
  const state = listenerStore.getState();
  if (
    state.getSessionMode(sessionId) !== "inactive" ||
    state.live.postStopProcessingBySession[sessionId]
  ) {
    return true;
  }
  return (await loadCaptureLifecycleMarker(sessionId)) !== null;
}

// Kept with the note rather than in the workflow's bounded processed list, so
// an old note never runs a speakers-named workflow twice.
export async function hasSpeakersNamedWorkflowRun(
  sessionId: string,
  workflowId: string,
): Promise<boolean> {
  return (await loadRanWorkflowIds(sessionId)).includes(workflowId);
}

export function markSpeakersNamedWorkflowRun(
  sessionId: string,
  workflowId: string,
): Promise<void> {
  return enqueueDatabaseWrite(`session:${sessionId}`, async () => {
    const ran = await loadRanWorkflowIds(sessionId);
    if (ran.includes(workflowId)) return;
    await executeTransaction([
      {
        sql: `
          UPDATE sessions
          SET metadata_json = json_set(
            CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END,
            '${RAN_WORKFLOWS_PATH}',
            json(?)
          )
          WHERE id = ? AND deleted_at IS NULL
        `,
        params: [JSON.stringify([...ran, workflowId]), sessionId],
      },
    ]);
  });
}

async function loadRanWorkflowIds(sessionId: string): Promise<string[]> {
  const rows = await liveQueryClient.execute<{ ran: string | null }>(
    `
      SELECT CASE WHEN json_valid(metadata_json)
        THEN json_extract(metadata_json, '${RAN_WORKFLOWS_PATH}')
      END AS ran
      FROM sessions
      WHERE id = ?
    `,
    [sessionId],
  );
  try {
    const parsed: unknown = JSON.parse(rows[0]?.ran ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

async function findTranscriptSessionId(
  transcriptId: string,
): Promise<string | undefined> {
  const rows = await liveQueryClient.execute<{ session_id: string }>(
    `SELECT session_id FROM transcripts WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [transcriptId],
  );
  return rows[0]?.session_id || undefined;
}
