import { describe, expect, it } from "vitest";

import type {
  ProvisionalSpeakerLabel,
  SegmentKey,
} from "@anlg/plugin-transcription";

import { areAllSpeakersNamed, groupSessionSpeakers } from "./session-speakers";

function segment(
  key: SegmentKey,
  speaker_label: string,
  words: string[],
  provisional_speaker?: ProvisionalSpeakerLabel,
) {
  return {
    key,
    speaker_label,
    provisional_speaker,
    words: words.map((id) => ({ id, text: ` ${id}` })),
  };
}

describe("groupSessionSpeakers", () => {
  it("keeps an unnamed diarized remote speaker unnamed beside a named one", () => {
    const speakers = groupSessionSpeakers([
      {
        transcriptId: "t1",
        selfHumanId: "self",
        segments: [
          segment(
            {
              channel: "RemoteParty",
              speaker_index: 0,
              speaker_human_id: "alice",
            },
            "Alice",
            ["w1", "w2"],
          ),
          segment({ channel: "RemoteParty", speaker_index: 1 }, "Speaker 1", [
            "w3",
          ]),
          segment(
            {
              channel: "RemoteParty",
              speaker_index: 0,
              speaker_human_id: "alice",
            },
            "Alice",
            ["w4"],
          ),
        ],
      },
    ]);

    expect(speakers).toMatchObject([
      {
        transcriptId: "t1",
        channel: 1,
        speakerIndex: 0,
        label: "Alice",
        humanId: "alice",
        isSelf: false,
        anchorWordId: "w1",
        wordIds: ["w1", "w2", "w4"],
        wordCount: 3,
        sample: "w1 w2 w4",
      },
      {
        channel: 1,
        speakerIndex: 1,
        label: "Speaker 1",
        humanId: null,
        isSelf: false,
        wordIds: ["w3"],
      },
    ]);
    expect(areAllSpeakersNamed(speakers)).toBe(false);
  });

  it("treats the owner's microphone as self whether assigned or inferred", () => {
    const speakers = groupSessionSpeakers([
      {
        transcriptId: "t1",
        selfHumanId: "self",
        segments: [
          segment(
            {
              channel: "DirectMic",
              speaker_index: 0,
              speaker_human_id: "self",
            },
            "You",
            ["w1"],
          ),
          segment({ channel: "DirectMic", speaker_index: 1 }, "You", ["w2"], {
            name: "You",
            human_id: "self",
            reason: "personal_microphone",
          }),
          segment(
            { channel: "RemoteParty", speaker_human_id: "alice" },
            "Alice",
            ["w3"],
          ),
        ],
      },
    ]);

    expect(
      speakers.map(({ label, humanId, isSelf }) => ({
        label,
        humanId,
        isSelf,
      })),
    ).toEqual([
      { label: "You", humanId: "self", isSelf: true },
      { label: "You", humanId: null, isSelf: true },
      { label: "Alice", humanId: "alice", isSelf: false },
    ]);
    expect(areAllSpeakersNamed(speakers)).toBe(true);
  });

  it("does not name an undiarized remote channel from its sole participant guess", () => {
    const speakers = groupSessionSpeakers([
      {
        transcriptId: "t1",
        selfHumanId: "self",
        segments: [
          segment(
            { channel: "RemoteParty", speaker_index: null },
            "Bob",
            ["w1"],
            {
              name: "Bob",
              human_id: "bob",
              reason: "sole_remote_participant",
            },
          ),
          segment(
            { channel: "RemoteParty", speaker_index: null },
            "Speaker 1",
            ["w2"],
          ),
        ],
      },
    ]);

    expect(speakers).toMatchObject([
      { speakerIndex: null, label: "Bob", humanId: null, isSelf: false },
      { speakerIndex: null, label: "Speaker 1", humanId: null },
    ]);
    expect(areAllSpeakersNamed(speakers)).toBe(false);
  });

  it("splits a speaker assigned for one segment into named and unnamed rows", () => {
    const speakers = groupSessionSpeakers([
      {
        transcriptId: "t1",
        selfHumanId: "self",
        segments: [
          segment({ channel: "MixedCapture", speaker_index: 2 }, "Speaker 1", [
            "w1",
          ]),
          segment(
            {
              channel: "MixedCapture",
              speaker_index: 2,
              speaker_human_id: "carol",
            },
            "Carol",
            ["w2"],
          ),
          segment({ channel: "MixedCapture", speaker_index: 2 }, "Speaker 1", [
            "w3",
          ]),
        ],
      },
    ]);

    expect(speakers).toMatchObject([
      { channel: 2, speakerIndex: 2, humanId: null, wordIds: ["w1", "w3"] },
      { channel: 2, speakerIndex: 2, humanId: "carol", wordIds: ["w2"] },
    ]);
    expect(new Set(speakers.map((speaker) => speaker.key)).size).toBe(2);
  });

  it("lists the same rendered speaker once per transcript, in note order", () => {
    const speakers = groupSessionSpeakers(
      ["t1", "t2"].map((transcriptId) => ({
        transcriptId,
        selfHumanId: "self",
        segments: [
          segment({ channel: "RemoteParty", speaker_index: 0 }, "Speaker 1", [
            `${transcriptId}-w1`,
          ]),
        ],
      })),
    );

    expect(
      speakers.map(({ transcriptId, anchorWordId }) => ({
        transcriptId,
        anchorWordId,
      })),
    ).toEqual([
      { transcriptId: "t1", anchorWordId: "t1-w1" },
      { transcriptId: "t2", anchorWordId: "t2-w1" },
    ]);
    expect(speakers[0]!.key).not.toBe(speakers[1]!.key);
  });

  it("cuts the sample at a whole word", () => {
    const words = Array.from({ length: 40 }, (_, index) => `word${index}`);
    const [speaker] = groupSessionSpeakers([
      {
        transcriptId: "t1",
        selfHumanId: null,
        segments: [
          segment({ channel: "RemoteParty", speaker_index: 0 }, "Speaker 1", [
            ...words,
          ]),
        ],
      },
    ]);

    expect(speaker!.sample.length).toBeLessThanOrEqual(120);
    expect(words.join(" ").startsWith(`${speaker!.sample} `)).toBe(true);
  });

  it("reports an empty note as not fully named", () => {
    const speakers = groupSessionSpeakers([]);

    expect(speakers).toEqual([]);
    expect(areAllSpeakersNamed(speakers)).toBe(false);
  });
});
