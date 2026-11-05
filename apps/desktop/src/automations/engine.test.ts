import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_MARKDOWN_EXPORT_OPTIONS } from "./markdown-export";

const mocks = vi.hoisted(() => ({
  exportMeetingMarkdown: vi.fn(),
  getStoredSettingValues: vi.fn(),
  setSettingValue: vi.fn(),
}));

vi.mock("@anlg/plugin-local-api", () => ({
  commands: {
    exportMeetingMarkdown: mocks.exportMeetingMarkdown,
  },
}));

vi.mock("~/settings/queries", () => ({
  getStoredSettingValues: mocks.getStoredSettingValues,
  setSettingValue: mocks.setSettingValue,
}));

import {
  parseAutomationRunRecord,
  runMeetingCompletedAutomations,
  runNoteEnhancedAutomations,
} from "./engine";

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
      mocks.setSettingValue.mock.calls.slice(-1)[0]![1] as string,
    );
    expect(saved[0].lastRun.status).toBe("error");
    expect(saved[0].processedSessionIds).toEqual([]);
  });
});
