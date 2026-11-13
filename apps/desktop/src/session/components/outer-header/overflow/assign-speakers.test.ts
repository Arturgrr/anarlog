import { describe, expect, it } from "vitest";

import {
  planSpeakerAssignments,
  toSpeakerAssignmentCall,
} from "./assign-speakers";

import type { SessionSpeaker } from "~/stt/session-speakers";

function speaker(
  key: string,
  overrides: Partial<SessionSpeaker> = {},
): SessionSpeaker {
  return {
    key,
    transcriptId: "t1",
    channel: 1,
    speakerIndex: 0,
    label: key,
    humanId: null,
    isSelf: false,
    anchorWordId: `${key}-w1`,
    wordIds: [`${key}-w1`, `${key}-w2`],
    wordCount: 2,
    sample: "hello",
    ...overrides,
  };
}

describe("planSpeakerAssignments", () => {
  it("applies only changed rows, in dialog order, and keeps shared or undiarized speakers word-scoped", () => {
    const speakers = [
      speaker("self", { channel: 0, speakerIndex: null, isSelf: true }),
      speaker("sole", { speakerIndex: 0 }),
      speaker("named-part", { speakerIndex: 1, humanId: "alice" }),
      speaker("unnamed-part", { speakerIndex: 1 }),
      speaker("unchanged", { speakerIndex: 2, humanId: "bob" }),
      speaker("undiarized", { channel: 2, speakerIndex: null }),
      speaker("other-transcript", { transcriptId: "t2", speakerIndex: 1 }),
    ];

    const plan = planSpeakerAssignments(speakers, {
      self: { id: "carol" },
      "other-transcript": { id: "alice" },
      sole: { id: "alice" },
      "unnamed-part": { id: "alice" },
      unchanged: { id: "bob" },
      undiarized: { id: "new", isNew: true },
    });

    expect(plan.map((step) => [step.speaker.key, step.scope])).toEqual([
      ["sole", "speaker"],
      ["unnamed-part", "words"],
      ["undiarized", "words"],
      ["other-transcript", "speaker"],
    ]);
  });
});

describe("toSpeakerAssignmentCall", () => {
  it("scopes a shared speaker's write to exactly its own words", () => {
    const row = speaker("unnamed-part", { speakerIndex: 1 });

    expect(
      toSpeakerAssignmentCall({
        sessionId: "s1",
        humanId: "alice",
        step: { speaker: row, scope: "words", anchorWordId: "unnamed-part-w1" },
      }),
    ).toEqual({
      kind: "words",
      args: {
        transcriptId: "t1",
        segmentKey: {
          channel: "RemoteParty",
          speaker_index: 1,
          speaker_human_id: null,
        },
        humanId: "alice",
        anchorWordId: "unnamed-part-w1",
        mode: "segment",
        wordIds: ["unnamed-part-w1", "unnamed-part-w2"],
        extendToAdjacent: false,
      },
    });
  });

  it("assigns a sole diarized speaker through the session speaker mutation", () => {
    const row = speaker("sole", { channel: 2, speakerIndex: 3 });

    expect(
      toSpeakerAssignmentCall({
        sessionId: "s1",
        humanId: "alice",
        step: { speaker: row, scope: "speaker", anchorWordId: "sole-w1" },
      }),
    ).toEqual({
      kind: "speaker",
      args: {
        sessionId: "s1",
        transcriptId: "t1",
        segmentKey: {
          channel: "MixedCapture",
          speaker_index: 3,
          speaker_human_id: null,
        },
        humanId: "alice",
        anchorWordId: "sole-w1",
        wordIds: ["sole-w1", "sole-w2"],
      },
    });
  });
});
