import type { LanguageModel } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskConfig } from ".";
import { enhanceSuccess, runEnhanceSuccess } from "./enhance-success";

import { useLiveTitle } from "~/store/zustand/live-title";

const mocks = vi.hoisted(() => ({
  loadSessionContentSnapshot: vi.fn(),
  playCompletionSound: vi.fn(),
  persistGeneratedEnhancedNote: vi.fn().mockResolvedValue(undefined),
  prepareGeneratedSummary: vi.fn(),
  composeGeneratedSummary: vi.fn(),
}));

vi.mock("@anlg/plugin-template", () => ({
  commands: {
    prepareGeneratedSummary: mocks.prepareGeneratedSummary,
    composeGeneratedSummary: mocks.composeGeneratedSummary,
  },
}));

vi.mock("~/session/content-queries", () => ({
  loadSessionContentSnapshot: mocks.loadSessionContentSnapshot,
}));

vi.mock("~/shared/completion-sound", () => ({
  playCompletionSound: mocks.playCompletionSound,
}));

vi.mock("~/shared/notification-policy", () => ({
  shouldShowNotification: vi.fn().mockResolvedValue(true),
}));

vi.mock("~/session/content-mutations", () => ({
  persistGeneratedEnhancedNote: mocks.persistGeneratedEnhancedNote,
}));

type EnhanceSuccessParams = Parameters<
  NonNullable<TaskConfig<"enhance">["onSuccess"]>
>[0];

function createSnapshot(title = "") {
  return {
    sessionId: "session-1",
    ownerUserId: "user-1",
    title,
    createdAt: "2026-07-10T00:00:00.000Z",
    event: null,
    eventId: null,
    rawNoteId: "session-1",
    rawTemplateId: "",
    rawContent: "",
    rawContentFormat: "prosemirror_json",
    rawMarkdown: "",
    enhancedNotes: [
      {
        id: "note-1",
        title: "",
        markdown: "",
        content: "old content",
        contentFormat: "markdown",
        templateId: "",
        position: 0,
      },
    ],
    transcripts: [],
    participants: [],
  };
}

function createTransformedArgs(): EnhanceSuccessParams["transformedArgs"] {
  return {
    language: "en",
    formatOverride: "",
    session: {
      title: "Weekly Review",
      startedAt: null,
      endedAt: null,
      event: null,
    },
    participants: [],
    template: null,
    preMeetingMemo: "",
    postMeetingMemo: "",
    transcripts: [],
    imageContext: [],
    lengthPolicy: null,
    dictionaryTerms: [],
  };
}

function createParams(
  overrides: Partial<EnhanceSuccessParams> = {},
): EnhanceSuccessParams {
  return {
    taskId: "note-1-enhance",
    text: "# Summary\n\n- Point",
    model: {} as LanguageModel,
    args: {
      sessionId: "session-1",
      enhancedNoteId: "note-1",
      templateId: undefined,
    },
    transformedArgs: createTransformedArgs(),
    signal: new AbortController().signal,
    startTask: vi.fn().mockResolvedValue(undefined),
    getTaskState: vi.fn().mockReturnValue(undefined),
    ...overrides,
  };
}

describe("enhanceSuccess.onSuccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLiveTitle.setState({ titles: {} });
    mocks.loadSessionContentSnapshot.mockResolvedValue(createSnapshot());
    mocks.persistGeneratedEnhancedNote.mockResolvedValue(undefined);
    mocks.prepareGeneratedSummary
      .mockReset()
      .mockImplementation(async ({ text }) => ({
        status: "ok",
        data: text.trim()
          ? {
              text,
              tag_names: [],
              text_with_tags: text,
            }
          : null,
      }));
    mocks.composeGeneratedSummary
      .mockReset()
      .mockImplementation(async ({ text }) => ({
        status: "ok",
        data: text,
      }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists generated content and tags through one guarded SQLite write", async () => {
    const params = createParams({
      text: "# Summary\n\nDiscussed #Launch.",
      transformedArgs: {
        ...createTransformedArgs(),
        preMeetingMemo: "Prep #prep #Launch",
      },
    });
    mocks.prepareGeneratedSummary.mockResolvedValueOnce({
      status: "ok",
      data: {
        text: "# Summary\n\nDiscussed #Launch.",
        tag_names: ["launch", "prep"],
        text_with_tags: "# Summary\n\nDiscussed #Launch.\n\n#launch #prep",
      },
    });

    await enhanceSuccess.onSuccess?.(params);

    expect(mocks.prepareGeneratedSummary).toHaveBeenCalledWith({
      text: "# Summary\n\nDiscussed #Launch.",
      tag_sources: ["Prep #prep #Launch", ""],
    });
    expect(mocks.persistGeneratedEnhancedNote).toHaveBeenCalledWith({
      sessionId: "session-1",
      ownerUserId: "user-1",
      note: {
        id: "note-1",
        currentContent: "old content",
        currentContentFormat: "markdown",
        nextContent: expect.any(String),
      },
      tagNames: ["launch", "prep"],
    });
    expect(mocks.composeGeneratedSummary).toHaveBeenCalledWith({
      text: "# Summary\n\nDiscussed #Launch.",
      title: null,
      tag_names: ["launch", "prep"],
    });
    expect(params.startTask).toHaveBeenCalledWith(
      "session-1-title",
      expect.objectContaining({
        args: expect.objectContaining({
          enhancedNote: "# Summary\n\nDiscussed #Launch.\n\n#launch #prep",
        }),
      }),
    );
  });

  it("uses the durable auto-enhance baseline instead of a later user edit", async () => {
    const snapshot = createSnapshot("Meeting title");
    snapshot.enhancedNotes[0].content = "user edit";
    snapshot.enhancedNotes[0].contentFormat = "prosemirror_json";
    mocks.loadSessionContentSnapshot.mockResolvedValue(snapshot);

    await enhanceSuccess.onSuccess?.(
      createParams({
        args: {
          sessionId: "session-1",
          enhancedNoteId: "note-1",
          templateId: undefined,
          pendingAutoEnhance: {
            generation: "generation-1",
            expectedBody: "old content",
            expectedContentFormat: "markdown",
          },
        },
      }),
    );

    expect(mocks.persistGeneratedEnhancedNote).toHaveBeenCalledWith(
      expect.objectContaining({
        note: expect.objectContaining({
          currentContent: "old content",
          currentContentFormat: "markdown",
        }),
        pendingAutoEnhance: {
          generation: "generation-1",
          expectedBody: "old content",
          expectedContentFormat: "markdown",
        },
      }),
    );
  });

  it("saves the generated title and summary in the same request", async () => {
    const startTask = vi.fn().mockImplementation(async (_taskId, config) => {
      config.onComplete?.("Generated title");
    });

    await enhanceSuccess.onSuccess?.(createParams({ startTask }));

    expect(startTask).toHaveBeenCalledWith(
      "session-1-title",
      expect.objectContaining({
        taskType: "title",
        args: expect.objectContaining({ skipPersist: true }),
      }),
    );
    expect(startTask).toHaveBeenCalledWith(
      "session-1-title",
      expect.objectContaining({
        args: expect.objectContaining({
          enhancedNote: "# Summary\n\n- Point",
        }),
      }),
    );
    expect(mocks.composeGeneratedSummary).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Generated title" }),
    );
    expect(mocks.persistGeneratedEnhancedNote).toHaveBeenCalledWith(
      expect.objectContaining({
        title: { currentTitle: "", nextTitle: "Generated title" },
      }),
    );
  });

  it("regenerates the title instead of reusing an earlier finished title", async () => {
    const startTask = vi.fn().mockImplementation(async (_taskId, config) => {
      config.onComplete?.("New title");
    });

    await enhanceSuccess.onSuccess?.(
      createParams({
        startTask,
        getTaskState: vi.fn().mockReturnValue({
          taskType: "title",
          status: "success",
          streamedText: "Old title",
          abortController: null,
        }),
      }),
    );

    expect(startTask).toHaveBeenCalledWith(
      "session-1-title",
      expect.objectContaining({ taskType: "title" }),
    );
    expect(mocks.persistGeneratedEnhancedNote).toHaveBeenCalledWith(
      expect.objectContaining({
        title: { currentTitle: "", nextTitle: "New title" },
      }),
    );
  });

  it("uses an existing title without starting title generation", async () => {
    mocks.loadSessionContentSnapshot.mockResolvedValue(
      createSnapshot("Existing title"),
    );
    const params = createParams();

    await enhanceSuccess.onSuccess?.(params);

    expect(params.startTask).not.toHaveBeenCalled();
    expect(
      mocks.persistGeneratedEnhancedNote.mock.calls[0]?.[0].title,
    ).toBeUndefined();
    expect(mocks.composeGeneratedSummary).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Existing title" }),
    );
  });

  it("does not claim success when the guarded SQLite write fails", async () => {
    mocks.persistGeneratedEnhancedNote.mockRejectedValueOnce(
      new Error("stale summary"),
    );

    await expect(
      enhanceSuccess.onSuccess?.(
        createParams({
          getTaskState: vi.fn().mockReturnValue({
            taskType: "title",
            status: "generating",
            streamedText: "",
            abortController: null,
          }),
        }),
      ),
    ).rejects.toThrow("stale summary");
  });

  it("retries a transient database lock while saving generated content", async () => {
    vi.useFakeTimers();
    mocks.persistGeneratedEnhancedNote
      .mockRejectedValueOnce(new Error("database is locked"))
      .mockResolvedValueOnce(undefined);

    const persist = enhanceSuccess.onSuccess?.(createParams());
    await vi.advanceTimersByTimeAsync(100);
    await persist;

    expect(mocks.persistGeneratedEnhancedNote).toHaveBeenCalledTimes(2);
  });

  it("does not retry persistence after cancellation during a database lock", async () => {
    vi.useFakeTimers();
    const abortController = new AbortController();
    mocks.persistGeneratedEnhancedNote.mockImplementationOnce(async () => {
      abortController.abort();
      throw new Error("database is locked");
    });

    const persist = enhanceSuccess.onSuccess?.(
      createParams({ signal: abortController.signal }),
    );
    await vi.advanceTimersByTimeAsync(100);
    await persist;

    expect(mocks.persistGeneratedEnhancedNote).toHaveBeenCalledOnce();
  });

  it("does not save after cancellation during title generation", async () => {
    const abortController = new AbortController();
    const startTask = vi.fn().mockImplementation(async (_taskId, config) => {
      abortController.abort();
      config.onComplete?.("Generated title");
    });

    await runEnhanceSuccess(
      createParams({ signal: abortController.signal, startTask }),
    );

    expect(mocks.persistGeneratedEnhancedNote).not.toHaveBeenCalled();
  });

  it("rejects persistence when the target summary disappeared", async () => {
    const snapshot = createSnapshot("Existing title");
    snapshot.enhancedNotes = [];
    mocks.loadSessionContentSnapshot.mockResolvedValue(snapshot);

    await expect(enhanceSuccess.onSuccess?.(createParams())).rejects.toThrow(
      "Summary note-1 no longer exists",
    );
  });

  it("does not generate a title while a live title edit exists", async () => {
    useLiveTitle.getState().setTitle("session-1", "Draft title");
    const params = createParams();

    await enhanceSuccess.onSuccess?.(params);

    expect(params.startTask).not.toHaveBeenCalled();
    expect(
      mocks.persistGeneratedEnhancedNote.mock.calls[0]?.[0].title,
    ).toBeUndefined();
  });
});
