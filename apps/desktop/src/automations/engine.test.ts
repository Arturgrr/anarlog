import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_MARKDOWN_EXPORT_OPTIONS } from "./markdown-export";

const mocks = vi.hoisted(() => ({
  exportMeetingMarkdown: vi.fn(),
  getStoredSettingValues: vi.fn(),
  setSettingValue: vi.fn(),
  getSessionNoteType: vi.fn(),
  requestAutoEnhance: vi.fn(),
  loadFolderPaths: vi.fn(),
  updateSession: vi.fn(),
  speakersNamedRuns: new Set<string>(),
}));

vi.mock("./speakers-named", () => ({
  hasSpeakersNamedWorkflowRun: async (sessionId: string, workflowId: string) =>
    mocks.speakersNamedRuns.has(`${sessionId}:${workflowId}`),
  markSpeakersNamedWorkflowRun: async (
    sessionId: string,
    workflowId: string,
  ) => {
    mocks.speakersNamedRuns.add(`${sessionId}:${workflowId}`);
  },
}));

vi.mock("~/note-types/queries", () => ({
  getSessionNoteType: mocks.getSessionNoteType,
}));

vi.mock("~/services/enhancer", () => ({
  getEnhancerService: () => ({ requestAutoEnhance: mocks.requestAutoEnhance }),
}));

vi.mock("~/session/queries/folders", () => ({
  loadFolderPaths: mocks.loadFolderPaths,
}));

vi.mock("~/session/queries/sessions", () => ({
  updateSession: mocks.updateSession,
}));

vi.mock("@anlg/plugin-local-api", () => ({
  commands: {
    exportMeetingMarkdown: mocks.exportMeetingMarkdown,
  },
}));

vi.mock("~/settings/queries", () => ({
  getStoredSettingValues: mocks.getStoredSettingValues,
  setSettingValue: mocks.setSettingValue,
  setSettingValues: async (values: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(values)) {
      await mocks.setSettingValue(key, value);
    }
  },
}));

import {
  parseAutomationRunRecord,
  runMeetingCompletedAutomations,
  runNoteEnhancedAutomations,
  runSpeakersNamedAutomations,
} from "./engine";
import { readAutomationWorkflows } from "./workflows";

function storedSettings(values: Record<string, unknown>) {
  mocks.getStoredSettingValues.mockResolvedValue({
    values,
    hasValues: new Set(Object.keys(values)),
  });
}

function recordedRun(settingKey: string) {
  const calls = mocks.setSettingValue.mock.calls.filter(
    (entry) => entry[0] === settingKey,
  );
  const call = calls[calls.length - 1];
  return call ? parseAutomationRunRecord(call[1] as string) : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.speakersNamedRuns.clear();
  mocks.setSettingValue.mockResolvedValue(undefined);
});

describe("runMeetingCompletedAutomations (markdown export)", () => {
  it("does nothing while the automation is disabled", async () => {
    storedSettings({
      automation_markdown_export_enabled: false,
      automation_markdown_export_directory: "/exports",
    });

    await runMeetingCompletedAutomations("session-1");

    expect(mocks.exportMeetingMarkdown).not.toHaveBeenCalled();
    expect(mocks.setSettingValue).not.toHaveBeenCalled();
  });

  it("exports the meeting and records a successful run", async () => {
    storedSettings({
      automation_markdown_export_enabled: true,
      automation_markdown_export_directory: "/exports",
    });
    mocks.exportMeetingMarkdown.mockResolvedValue({
      status: "ok",
      data: { path: "/exports/2026-08-07 Standup [abc123].md", sha256: "hash" },
    });

    await runMeetingCompletedAutomations("session-1");

    expect(mocks.exportMeetingMarkdown).toHaveBeenCalledWith(
      "session-1",
      "/exports",
      null,
      null,
    );
    expect(recordedRun("automation_markdown_export_last_run")).toMatchObject({
      status: "success",
      detail: "/exports/2026-08-07 Standup [abc123].md",
    });
  });

  it("records a failed run when the export command errors", async () => {
    storedSettings({
      automation_markdown_export_enabled: true,
      automation_markdown_export_directory: "/exports",
    });
    mocks.exportMeetingMarkdown.mockResolvedValue({
      status: "error",
      error: "could not write markdown export: denied",
    });

    await runMeetingCompletedAutomations("session-1");

    expect(recordedRun("automation_markdown_export_last_run")).toMatchObject({
      status: "error",
      detail: "could not write markdown export: denied",
    });
  });
});

describe("parsers", () => {
  it("round-trips run records and rejects malformed values", () => {
    const record = {
      at: "2026-08-07T12:00:00.000Z",
      status: "success",
      detail: "/exports/file.md",
    };
    expect(parseAutomationRunRecord(JSON.stringify(record))).toEqual(record);
    expect(parseAutomationRunRecord(undefined)).toBeNull();
    expect(parseAutomationRunRecord("{broken")).toBeNull();
    expect(parseAutomationRunRecord('{"status":"success"}')).toBeNull();
  });
});

describe("custom workflows", () => {
  it("skips disabled or already processed workflows", async () => {
    storedSettings({
      automation_workflows: JSON.stringify([
        {
          id: "wf-1",
          title: "Disabled",
          enabled: false,
          trigger: "note_enhanced",
          steps: [
            { id: "step-1", type: "markdown_export", directory: "/exports" },
          ],
          processedSessionIds: [],
        },
        {
          id: "wf-2",
          title: "Already ran",
          enabled: true,
          trigger: "meeting_completed",
          steps: [
            { id: "step-1", type: "markdown_export", directory: "/exports" },
          ],
          processedSessionIds: ["session-1"],
        },
      ]),
    });

    await runNoteEnhancedAutomations("session-1");
    await runMeetingCompletedAutomations("session-1");

    expect(mocks.exportMeetingMarkdown).not.toHaveBeenCalled();
  });
});

describe("configured Markdown workflows", () => {
  it.each(["meeting_completed", "note_enhanced"] as const)(
    "passes selected options to the writer on %s and saves them with the result",
    async (trigger) => {
      const options = {
        ...DEFAULT_MARKDOWN_EXPORT_OPTIONS,
        include_memo: false,
        include_transcript: false,
        include_action_items: false,
        filename: "{title} recap",
        include_id_suffix: false,
      };
      storedSettings({
        automation_workflows: JSON.stringify([
          {
            id: "wf-markdown",
            enabled: true,
            trigger,
            steps: [
              {
                id: "step",
                type: "markdown_export",
                directory: " /exports ",
                options,
              },
            ],
          },
        ]),
      });
      mocks.exportMeetingMarkdown.mockResolvedValue({
        status: "ok",
        data: { path: "/exports/Planning recap.md", sha256: "hash" },
      });
      await (
        trigger === "meeting_completed"
          ? runMeetingCompletedAutomations
          : runNoteEnhancedAutomations
      )("session-1");
      expect(mocks.exportMeetingMarkdown).toHaveBeenCalledWith(
        "session-1",
        "/exports",
        options,
        null,
      );
      const saved = JSON.parse(
        mocks.setSettingValue.mock.calls
          .filter((entry) => entry[0] === "automation_workflows")
          .slice(-1)[0]![1] as string,
      );
      expect(saved[0].steps[0].options).toEqual(options);
      expect(saved[0].lastRun).toMatchObject({
        status: "success",
        detail: "/exports/Planning recap.md",
      });
    },
  );

  it("asks the exporter to replace the file from the previous title", async () => {
    storedSettings({
      automation_workflows: JSON.stringify([
        {
          id: "wf-markdown",
          enabled: true,
          trigger: "note_enhanced",
          steps: [
            { id: "step-md", type: "markdown_export", directory: "/exports" },
          ],
          processedSessionIds: ["session-1"],
        },
      ]),
      automation_markdown_export_files: JSON.stringify([
        {
          key: "wf-markdown:step-md:session-1",
          path: "/exports/Planning.md",
          sha256: "old",
        },
      ]),
    });
    mocks.exportMeetingMarkdown.mockResolvedValue({
      status: "ok",
      data: { path: "/exports/Launch.md", sha256: "new" },
    });

    await runNoteEnhancedAutomations("session-1");

    expect(mocks.exportMeetingMarkdown).toHaveBeenCalledWith(
      "session-1",
      "/exports",
      null,
      { path: "/exports/Planning.md", sha256: "old" },
    );
    expect(
      JSON.parse(
        mocks.setSettingValue.mock.calls.find(
          (entry) => entry[0] === "automation_markdown_export_files",
        )?.[1] as string,
      ),
    ).toEqual([
      {
        key: "wf-markdown:step-md:session-1",
        path: "/exports/Launch.md",
        sha256: "new",
      },
    ]);
  });

  it("still writes the Markdown file when a stored workflow has a removed Slack step", async () => {
    storedSettings({
      automation_workflows: JSON.stringify([
        {
          id: "wf-markdown",
          enabled: true,
          trigger: "note_enhanced",
          steps: [
            {
              id: "step-slack",
              type: "slack_recap",
              target: { id: "C123", name: "general" },
            },
            { id: "step-md", type: "markdown_export", directory: "/exports" },
          ],
          processedSessionIds: ["session-1"],
        },
      ]),
    });
    mocks.exportMeetingMarkdown.mockResolvedValue({
      status: "ok",
      data: { path: "/exports/Planning.md", sha256: "hash" },
    });

    await runNoteEnhancedAutomations("session-1");

    expect(mocks.exportMeetingMarkdown).toHaveBeenCalledWith(
      "session-1",
      "/exports",
      null,
      null,
    );
  });

  it("records an empty-selection error without writing a file", async () => {
    storedSettings({
      automation_workflows: JSON.stringify([
        {
          id: "wf-markdown",
          enabled: true,
          trigger: "meeting_completed",
          steps: [
            {
              id: "step",
              type: "markdown_export",
              directory: "/exports",
              options: {
                ...DEFAULT_MARKDOWN_EXPORT_OPTIONS,
                include_memo: false,
                include_summary: false,
                include_transcript: false,
                include_action_items: false,
              },
            },
          ],
        },
      ]),
    });
    await runMeetingCompletedAutomations("session-1");
    expect(mocks.exportMeetingMarkdown).not.toHaveBeenCalled();
    const saved = JSON.parse(
      mocks.setSettingValue.mock.calls
        .filter((entry) => entry[0] === "automation_workflows")
        .slice(-1)[0]![1] as string,
    );
    expect(saved[0].lastRun.status).toBe("error");
    expect(saved[0].processedSessionIds).toEqual([]);
  });
});

describe("workflow conditions and summary steps", () => {
  function persistentSettings(values: Record<string, unknown>) {
    storedSettings(values);
    mocks.setSettingValue.mockImplementation(async (key: string, value) => {
      values[key] = value;
    });
  }

  function exportWorkflow(
    directory: string,
    conditions: { noteTypeId: string; noteSubtypeId?: string } | undefined,
  ) {
    return {
      id: `wf-${directory}`,
      enabled: true,
      trigger: "meeting_completed",
      ...(conditions ? { conditions } : {}),
      steps: [{ id: "step", type: "markdown_export", directory }],
    };
  }

  it("runs only the workflows whose type and subtype match the note", async () => {
    persistentSettings({
      automation_workflows: JSON.stringify([
        exportWorkflow("/every", undefined),
        exportWorkflow("/ferreri", { noteTypeId: "ferreri" }),
        exportWorkflow("/daily", {
          noteTypeId: "ferreri",
          noteSubtypeId: "daily",
        }),
        exportWorkflow("/weekly", {
          noteTypeId: "ferreri",
          noteSubtypeId: "weekly",
        }),
        exportWorkflow("/aula", { noteTypeId: "aula" }),
      ]),
    });
    mocks.getSessionNoteType.mockResolvedValue({
      typeId: "ferreri",
      subtypeId: "daily",
    });
    mocks.exportMeetingMarkdown.mockImplementation(async (_id, directory) => ({
      status: "ok",
      data: { path: `${directory}/note.md`, sha256: "hash" },
    }));

    await runMeetingCompletedAutomations("session-1");

    expect(
      mocks.exportMeetingMarkdown.mock.calls.map(([, directory]) => directory),
    ).toEqual(["/every", "/ferreri", "/daily"]);
  });

  it("runs a speakers-named workflow once per note and keeps going after a failed step", async () => {
    const values: Record<string, unknown> = {
      automation_workflows: JSON.stringify([
        {
          id: "wf-named",
          enabled: true,
          trigger: "speakers_named",
          steps: [
            { id: "move", type: "move_to_folder", folderPath: "Deleted" },
            { id: "regen", type: "regenerate_summary" },
          ],
        },
      ]),
    };
    persistentSettings(values);
    mocks.loadFolderPaths.mockResolvedValue(["Work"]);
    mocks.requestAutoEnhance.mockResolvedValue(undefined);

    await runSpeakersNamedAutomations("session-1");
    await runSpeakersNamedAutomations("session-1");

    expect(mocks.updateSession).not.toHaveBeenCalled();
    expect(mocks.requestAutoEnhance).toHaveBeenCalledTimes(1);
    expect(mocks.requestAutoEnhance).toHaveBeenCalledWith(
      "session-1",
      "regenerate",
    );
    const [saved] = readAutomationWorkflows(values);
    expect(saved.lastRun?.status).toBe("error");
    expect(saved.processedSessionIds).toEqual(["session-1"]);
  });

  it("does not rerun a speakers-named workflow on an old note after 50 later notes ran it", async () => {
    persistentSettings({
      automation_workflows: JSON.stringify([
        {
          id: "wf-named",
          enabled: true,
          trigger: "speakers_named",
          steps: [{ id: "regen", type: "regenerate_summary" }],
        },
      ]),
    });
    mocks.requestAutoEnhance.mockResolvedValue(undefined);

    await runSpeakersNamedAutomations("session-old");
    for (let index = 0; index < 50; index++) {
      await runSpeakersNamedAutomations(`session-${index}`);
    }
    await runSpeakersNamedAutomations("session-old");

    expect(
      mocks.requestAutoEnhance.mock.calls.filter(
        ([sessionId]) => sessionId === "session-old",
      ),
    ).toHaveLength(1);
  });

  it("moves the note into an existing folder", async () => {
    persistentSettings({
      automation_workflows: JSON.stringify([
        {
          id: "wf-move",
          enabled: true,
          trigger: "meeting_completed",
          steps: [{ id: "move", type: "move_to_folder", folderPath: "Work" }],
        },
      ]),
    });
    mocks.loadFolderPaths.mockResolvedValue(["Work"]);
    mocks.updateSession.mockResolvedValue(undefined);

    await runMeetingCompletedAutomations("session-1");

    expect(mocks.updateSession).toHaveBeenCalledWith("session-1", {
      folder_id: "Work",
    });
  });

  it.each(["note_enhanced", "meeting_completed"] as const)(
    "never regenerates the summary from a %s workflow",
    async (trigger) => {
      persistentSettings({
        automation_workflows: JSON.stringify([
          {
            id: "wf-loop",
            enabled: true,
            trigger,
            steps: [
              { id: "regen", type: "regenerate_summary" },
              { id: "md", type: "markdown_export", directory: "/exports" },
            ],
          },
        ]),
      });
      mocks.exportMeetingMarkdown.mockResolvedValue({
        status: "ok",
        data: { path: "/exports/note.md", sha256: "hash" },
      });

      await (
        trigger === "meeting_completed"
          ? runMeetingCompletedAutomations
          : runNoteEnhancedAutomations
      )("session-1");

      expect(mocks.requestAutoEnhance).not.toHaveBeenCalled();
      expect(mocks.exportMeetingMarkdown).toHaveBeenCalledTimes(1);
    },
  );
});
