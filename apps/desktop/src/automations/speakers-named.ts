import { liveQueryClient } from "~/db";

// stt/queries calls this after every speaker assignment, and
// stt/session-speakers imports stt/queries, so it and the engine load lazily
// to keep the static import graph acyclic.
export function emitSpeakersNamedIfComplete(
  target: { sessionId: string } | { transcriptId: string },
): void {
  void (async () => {
    const sessionId =
      "sessionId" in target
        ? target.sessionId
        : await findTranscriptSessionId(target.transcriptId);
    if (!sessionId) {
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

async function findTranscriptSessionId(
  transcriptId: string,
): Promise<string | undefined> {
  const rows = await liveQueryClient.execute<{ session_id: string }>(
    `SELECT session_id FROM transcripts WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [transcriptId],
  );
  return rows[0]?.session_id || undefined;
}
