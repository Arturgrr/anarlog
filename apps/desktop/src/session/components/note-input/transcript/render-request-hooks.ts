import { useMemo } from "react";

import type {
  RenderTranscriptHuman,
  RenderTranscriptRequest,
  SpeakerContext,
} from "@anlg/plugin-transcription";

import {
  type TranscriptRecord,
  getSessionParticipantHumanIds,
  getSessionTranscriptRecords,
  getTranscriptHumans,
  useSessionParticipantHumanIds,
  useSessionTranscripts,
  useTranscript,
  useTranscriptHumans,
} from "~/stt/queries";
import {
  buildRenderTranscriptRequestFromRows,
  collectAssignedHumanIdsFromTranscriptRows,
  type TranscriptRow,
} from "~/stt/render-transcript";
import {
  getSpeakerContext,
  useSpeakerContext,
} from "~/stt/speaker-context-query";

export type TranscriptRowWithId = {
  transcriptId: string;
  row: TranscriptRow;
};

export function toTranscriptRows(
  transcripts: readonly TranscriptRecord[],
): TranscriptRowWithId[] {
  return transcripts.map((transcript) => ({
    transcriptId: transcript.id,
    row: {
      ...(transcript.source ? { source: transcript.source } : {}),
      ...(transcript.provider ? { provider: transcript.provider } : {}),
      started_at: transcript.startedAt,
      words: transcript.words,
      speaker_hints: transcript.speakerHints,
    },
  }));
}

export function collectRenderHumanIds(
  participantHumanIds: readonly string[],
  assignedHumanIds: readonly string[],
  selfHumanId?: string,
): string[] {
  return [
    ...new Set([
      ...participantHumanIds,
      ...assignedHumanIds,
      selfHumanId ?? "",
    ]),
  ].filter(Boolean);
}

export async function getSessionTranscriptRenderRequest(
  sessionId: string,
): Promise<RenderTranscriptRequest | null> {
  if (!sessionId) {
    return null;
  }

  const [transcripts, participantHumanIds, speakerContext] = await Promise.all([
    getSessionTranscriptRecords(sessionId),
    getSessionParticipantHumanIds(sessionId),
    getSpeakerContext(sessionId),
  ]);
  const humans = await getTranscriptHumans(
    getTranscriptRecordsRenderHumanIds(transcripts, participantHumanIds),
  );

  return buildTranscriptRecordsRenderRequest(
    transcripts,
    participantHumanIds,
    humans,
    speakerContext,
  );
}

export function getTranscriptRecordsRenderHumanIds(
  transcripts: readonly TranscriptRecord[],
  participantHumanIds: readonly string[],
): string[] {
  return collectRenderHumanIds(
    participantHumanIds,
    collectAssignedHumanIdsFromTranscriptRows(
      toTranscriptRows(transcripts).map(({ row }) => row),
    ),
    transcripts[0]?.ownerUserId,
  );
}

// `humans` may cover more people than these transcripts mention; keeping only
// theirs makes the request match the one the transcript view renders.
export function buildTranscriptRecordsRenderRequest(
  transcripts: readonly TranscriptRecord[],
  participantHumanIds: string[],
  humans: readonly RenderTranscriptHuman[],
  speakerContext?: SpeakerContext,
): RenderTranscriptRequest | null {
  const humanIds = new Set(
    getTranscriptRecordsRenderHumanIds(transcripts, participantHumanIds),
  );

  return buildRenderTranscriptRequestFromRows(
    toTranscriptRows(transcripts).map(({ row }) => row),
    {
      humans: humans.filter((human) => humanIds.has(human.human_id)),
      selfHumanId: transcripts[0]?.ownerUserId,
    },
    participantHumanIds,
    speakerContext,
  );
}

export function useTranscriptRenderData(
  transcriptId: string,
  includePendingDeltas = true,
): {
  request: RenderTranscriptRequest | null;
  transcriptRows: TranscriptRowWithId[];
} {
  const transcript = useTranscript(transcriptId, includePendingDeltas);
  const transcripts = useMemo(
    () => (transcript ? [transcript] : emptyTranscripts),
    [transcript],
  );

  return useRenderData(transcript?.sessionId ?? "", transcripts);
}

export function useSessionTranscriptRenderData(sessionId: string): {
  request: RenderTranscriptRequest | null;
  transcriptRows: TranscriptRowWithId[];
} {
  const transcripts = useSessionTranscripts(sessionId);

  return useRenderData(sessionId, transcripts);
}

function useRenderData(
  sessionId: string,
  transcripts: readonly TranscriptRecord[],
): {
  request: RenderTranscriptRequest | null;
  transcriptRows: TranscriptRowWithId[];
} {
  const speakerContext = useSpeakerContext(sessionId);
  const participantHumanIds = useSessionParticipantHumanIds(sessionId);
  const selfHumanId = transcripts[0]?.ownerUserId;

  const transcriptRows = useMemo(
    () => toTranscriptRows(transcripts),
    [transcripts],
  );

  const assignedHumanIds = useMemo(
    () =>
      collectAssignedHumanIdsFromTranscriptRows(
        transcriptRows.map((transcriptRow) => transcriptRow.row),
      ),
    [transcriptRows],
  );

  const humanIds = useMemo(
    () =>
      collectRenderHumanIds(participantHumanIds, assignedHumanIds, selfHumanId),
    [assignedHumanIds, participantHumanIds, selfHumanId],
  );
  const humans = useTranscriptHumans(humanIds);

  const request = useMemo(
    () =>
      buildRenderTranscriptRequestFromRows(
        transcriptRows.map((transcriptRow) => transcriptRow.row),
        { humans, selfHumanId },
        participantHumanIds,
        speakerContext,
      ),
    [humans, participantHumanIds, selfHumanId, transcriptRows, speakerContext],
  );

  return { request, transcriptRows };
}

const emptyTranscripts: TranscriptRecord[] = [];
