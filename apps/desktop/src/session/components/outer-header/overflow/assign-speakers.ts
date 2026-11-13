import { type SessionSpeaker, toChannelProfile } from "~/stt/session-speakers";

export function planSpeakerAssignments<
  Choice extends { id: string; isNew?: boolean },
>(speakers: SessionSpeaker[], choices: Partial<Record<string, Choice>>) {
  const rowsPerDiarizedSpeaker = new Map<string, number>();
  for (const speaker of speakers) {
    if (speaker.speakerIndex === null) continue;
    const key = diarizedSpeakerKey(speaker);
    rowsPerDiarizedSpeaker.set(key, (rowsPerDiarizedSpeaker.get(key) ?? 0) + 1);
  }

  return speakers.flatMap((speaker) => {
    const choice = choices[speaker.key];
    const anchorWordId = speaker.anchorWordId;
    if (!choice || speaker.isSelf || !anchorWordId) return [];
    if (!choice.isNew && choice.id === speaker.humanId) return [];

    // A diarized speaker shown in several rows is partly assigned already;
    // a speaker-wide write would overwrite the other rows' people.
    const scope: "speaker" | "words" =
      speaker.speakerIndex !== null &&
      rowsPerDiarizedSpeaker.get(diarizedSpeakerKey(speaker)) === 1
        ? "speaker"
        : "words";
    return [{ speaker, choice, scope, anchorWordId }];
  });
}

export function toSpeakerAssignmentCall({
  sessionId,
  humanId,
  step: { speaker, scope, anchorWordId },
}: {
  sessionId: string;
  humanId: string;
  step: {
    speaker: SessionSpeaker;
    scope: "speaker" | "words";
    anchorWordId: string;
  };
}) {
  const segmentKey = {
    channel: toChannelProfile(speaker.channel),
    speaker_index: speaker.speakerIndex,
    speaker_human_id: null,
  };

  return scope === "speaker"
    ? {
        kind: "speaker" as const,
        args: {
          sessionId,
          transcriptId: speaker.transcriptId,
          segmentKey,
          humanId,
          anchorWordId,
          wordIds: speaker.wordIds,
        },
      }
    : {
        kind: "words" as const,
        args: {
          transcriptId: speaker.transcriptId,
          segmentKey,
          humanId,
          anchorWordId,
          mode: "segment" as const,
          wordIds: speaker.wordIds,
          extendToAdjacent: false,
        },
      };
}

function diarizedSpeakerKey(speaker: SessionSpeaker): string {
  return JSON.stringify([
    speaker.transcriptId,
    speaker.channel,
    speaker.speakerIndex,
  ]);
}
