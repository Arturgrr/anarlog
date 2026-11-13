import { keepPreviousData, useQueries } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import type {
  ChannelProfile,
  RenderedTranscriptSegment,
} from "@anlg/plugin-transcription";

import { localizeSpeakerLabel } from "~/i18n/external-messages";
import { TRANSCRIPT_RENDER_CACHE_TIME_MS } from "~/session/components/note-input/transcript/cache";
import {
  buildTranscriptRecordsRenderRequest,
  getTranscriptRecordsRenderHumanIds,
} from "~/session/components/note-input/transcript/render-request-hooks";
import { getRenderedTranscriptSegmentsQueryKey } from "~/session/components/note-input/transcript/renderer/data-hooks";
import {
  type TranscriptRecord,
  getSessionParticipantHumanIds,
  getSessionTranscriptRecords,
  getTranscriptHumans,
  useSessionParticipantHumanIds,
  useSessionTranscripts,
  useTranscriptHumans,
} from "~/stt/queries";
import {
  getRenderTranscriptRequestKey,
  renderTranscriptSegments,
} from "~/stt/render-transcript";
import {
  getSpeakerContext,
  useSpeakerContext,
} from "~/stt/speaker-context-query";

export type SessionSpeaker = {
  key: string;
  transcriptId: string;
  channel: number;
  speakerIndex: number | null;
  label: string;
  humanId: string | null;
  isSelf: boolean;
  anchorWordId: string | null;
  wordIds: string[];
  wordCount: number;
  sample: string;
};

const SAMPLE_MAX_LENGTH = 120;

const CHANNEL_NUMBERS: Record<ChannelProfile, number> = {
  DirectMic: 0,
  RemoteParty: 1,
  MixedCapture: 2,
};

export async function getSessionSpeakers(
  sessionId: string,
): Promise<SessionSpeaker[]> {
  if (!sessionId) {
    return [];
  }

  const [transcripts, participantHumanIds, speakerContext] = await Promise.all([
    getSessionTranscriptRecords(sessionId),
    getSessionParticipantHumanIds(sessionId),
    getSpeakerContext(sessionId),
  ]);
  const humans = await getTranscriptHumans(
    collectHumanIds(transcripts, participantHumanIds),
  );

  return groupSessionSpeakers(
    await Promise.all(
      transcripts.map(async (transcript) => {
        const request = buildTranscriptRecordsRenderRequest(
          [transcript],
          participantHumanIds,
          humans,
          speakerContext,
        );
        return {
          transcriptId: transcript.id,
          selfHumanId: request?.self_human_id ?? null,
          segments: request ? await renderTranscriptSegments(request) : [],
        };
      }),
    ),
  );
}

export function toChannelProfile(channel: number): ChannelProfile {
  return channel === 0
    ? "DirectMic"
    : channel === 1
      ? "RemoteParty"
      : "MixedCapture";
}

export function useSessionSpeakers(sessionId: string): SessionSpeaker[] {
  return useSessionSpeakersState(sessionId).speakers;
}

export function useSessionSpeakersState(sessionId: string): {
  speakers: SessionSpeaker[];
  isLoading: boolean;
} {
  const transcripts = useSessionTranscripts(sessionId);
  const participantHumanIds = useSessionParticipantHumanIds(sessionId);
  const speakerContext = useSpeakerContext(sessionId);
  const humanIds = useMemo(
    () => collectHumanIds(transcripts, participantHumanIds),
    [participantHumanIds, transcripts],
  );
  const humans = useTranscriptHumans(humanIds);

  const requests = useMemo(
    () =>
      transcripts.map((transcript) => {
        const request = buildTranscriptRecordsRenderRequest(
          [transcript],
          participantHumanIds,
          humans,
          speakerContext,
        );
        return {
          transcriptId: transcript.id,
          request,
          requestKey: getRenderTranscriptRequestKey(request),
        };
      }),
    [humans, participantHumanIds, speakerContext, transcripts],
  );

  const combine = useCallback(
    (
      results: Array<{
        data?: RenderedTranscriptSegment[];
        isFetching: boolean;
      }>,
    ) => ({
      speakers: groupSessionSpeakers(
        requests.map(({ transcriptId, request }, index) => ({
          transcriptId,
          selfHumanId: request?.self_human_id ?? null,
          segments: results[index]?.data ?? [],
        })),
      ),
      isLoading: results.some(
        (result) => result.data === undefined && result.isFetching,
      ),
    }),
    [requests],
  );

  // Same key and options as the transcript view, so both share one native render.
  return useQueries({
    queries: requests.map(({ transcriptId, request, requestKey }) => ({
      queryKey: getRenderedTranscriptSegmentsQueryKey(
        transcriptId,
        "settled",
        requestKey,
      ),
      queryFn: async () => (request ? renderTranscriptSegments(request) : []),
      enabled: !!request,
      placeholderData: keepPreviousData,
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: TRANSCRIPT_RENDER_CACHE_TIME_MS,
    })),
    combine,
  });
}

export function areAllSpeakersNamed(speakers: SessionSpeaker[]): boolean {
  return (
    speakers.length > 0 &&
    speakers.every((speaker) => speaker.humanId !== null || speaker.isSelf)
  );
}

export function groupSessionSpeakers(
  transcripts: Array<{
    transcriptId: string;
    selfHumanId: string | null;
    segments: Array<
      Pick<
        RenderedTranscriptSegment,
        "key" | "speaker_label" | "provisional_speaker"
      > & { words: Array<{ id?: string | null; text: string }> }
    >;
  }>,
): SessionSpeaker[] {
  const speakers = new Map<
    string,
    Omit<SessionSpeaker, "sample"> & { text: string }
  >();

  for (const { transcriptId, selfHumanId, segments } of transcripts) {
    for (const segment of segments) {
      const humanId = segment.key.speaker_human_id || null;
      // A provisional name is a guess, not an assignment, but it is what the
      // transcript shows, so it separates rows without naming them.
      const provisional = humanId
        ? null
        : (segment.provisional_speaker ?? null);
      const speakerIndex = segment.key.speaker_index ?? null;
      const key = JSON.stringify([
        transcriptId,
        segment.key.channel,
        speakerIndex,
        humanId ?? null,
        provisional ? (provisional.human_id ?? provisional.name) : null,
      ]);

      let speaker = speakers.get(key);
      if (!speaker) {
        // The renderer guesses the owner only for the microphone, where it
        // shows "You"; a guess on any other channel is never the owner.
        const identityId =
          humanId ??
          (segment.key.channel === "DirectMic"
            ? (provisional?.human_id ?? null)
            : null);
        speaker = {
          key,
          transcriptId,
          channel: CHANNEL_NUMBERS[segment.key.channel],
          speakerIndex,
          label: localizeSpeakerLabel(segment.speaker_label),
          humanId,
          isSelf: !!selfHumanId && identityId === selfHumanId,
          anchorWordId: null,
          wordIds: [],
          wordCount: 0,
          text: "",
        };
        speakers.set(key, speaker);
      }

      for (const word of segment.words) {
        if (word.id) {
          speaker.wordIds.push(word.id);
          speaker.anchorWordId ??= word.id;
        }
        speaker.wordCount += 1;
        if (speaker.text.length <= SAMPLE_MAX_LENGTH) {
          speaker.text += word.text;
        }
      }
      if (speaker.text.length <= SAMPLE_MAX_LENGTH) {
        speaker.text += " ";
      }
    }
  }

  return [...speakers.values()].map(({ text, ...speaker }) => ({
    ...speaker,
    sample: toSample(text),
  }));
}

function collectHumanIds(
  transcripts: readonly TranscriptRecord[],
  participantHumanIds: readonly string[],
): string[] {
  return [
    ...new Set(
      transcripts.flatMap((transcript) =>
        getTranscriptRecordsRenderHumanIds([transcript], participantHumanIds),
      ),
    ),
  ];
}

function toSample(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= SAMPLE_MAX_LENGTH) {
    return normalized;
  }

  const cut = normalized.lastIndexOf(" ", SAMPLE_MAX_LENGTH);
  return cut > 0
    ? normalized.slice(0, cut)
    : normalized.slice(0, SAMPLE_MAX_LENGTH);
}
