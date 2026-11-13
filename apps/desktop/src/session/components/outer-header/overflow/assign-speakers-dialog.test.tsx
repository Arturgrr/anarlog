import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionSpeaker } from "~/stt/session-speakers";

const mocks = vi.hoisted(() => ({
  assignSessionTranscriptSpeaker: vi.fn(),
  assignTranscriptSpeaker: vi.fn(),
  onOpenChange: vi.fn(),
  speakers: [] as SessionSpeaker[],
}));

vi.mock("~/stt/queries", () => ({
  assignSessionTranscriptSpeaker: mocks.assignSessionTranscriptSpeaker,
  assignTranscriptSpeaker: mocks.assignTranscriptSpeaker,
}));
vi.mock("~/stt/session-speakers", () => ({
  toChannelProfile: (channel: number) =>
    ["DirectMic", "RemoteParty", "MixedCapture"][channel],
  areAllSpeakersNamed: () => false,
  useSessionSpeakersState: () => ({
    speakers: mocks.speakers,
    isLoading: false,
  }),
}));
vi.mock(
  "~/session/components/note-input/transcript/renderer/speaker-assign",
  () => ({
    useSpeakerParticipantOptions: () => ({
      participants: [],
      contacts: [],
      resolveHumanId: async (option: { id: string }) => option.id,
    }),
    SpeakerParticipantPicker: ({
      onPick,
    }: {
      onPick: (option: { id: string; name: string }) => void;
    }) => (
      <button
        type="button"
        onClick={() => onPick({ id: "alice", name: "Alice" })}
      >
        Pick Alice
      </button>
    ),
  }),
);

import { AssignSpeakersDialog } from "./assign-speakers-dialog";

function remoteSpeaker(): SessionSpeaker {
  return {
    key: "remote-0",
    transcriptId: "t1",
    channel: 1,
    speakerIndex: 0,
    label: "Speaker 1",
    humanId: null,
    isSelf: false,
    anchorWordId: "w1",
    wordIds: ["w1", "w2"],
    wordCount: 2,
    sample: "Shall we start",
  };
}

function renderDialog() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AssignSpeakersDialog
        sessionId="s1"
        open
        onOpenChange={mocks.onOpenChange}
      />
    </QueryClientProvider>,
  );
}

function pickAliceForSpeaker1() {
  fireEvent.click(
    screen.getByRole("button", { name: "Choose a person for Speaker 1" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Pick Alice" }));
}

describe("AssignSpeakersDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assignSessionTranscriptSpeaker.mockResolvedValue(undefined);
    mocks.speakers = [remoteSpeaker()];
  });
  afterEach(cleanup);

  it("writes the chosen person for a sole diarized speaker only on Apply", async () => {
    renderDialog();
    pickAliceForSpeaker1();
    expect(mocks.assignSessionTranscriptSpeaker).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(mocks.onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.assignSessionTranscriptSpeaker).toHaveBeenCalledWith({
      sessionId: "s1",
      transcriptId: "t1",
      segmentKey: {
        channel: "RemoteParty",
        speaker_index: 0,
        speaker_human_id: null,
      },
      humanId: "alice",
      anchorWordId: "w1",
      wordIds: ["w1", "w2"],
    });
    expect(mocks.assignTranscriptSpeaker).not.toHaveBeenCalled();
  });

  it("discards picked people on Cancel", () => {
    renderDialog();
    pickAliceForSpeaker1();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.assignSessionTranscriptSpeaker).not.toHaveBeenCalled();
    expect(mocks.assignTranscriptSpeaker).not.toHaveBeenCalled();
  });
});
