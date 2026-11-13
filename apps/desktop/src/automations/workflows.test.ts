import { describe, expect, it } from "vitest";

import {
  DEFAULT_MARKDOWN_EXPORT_OPTIONS,
  parseMarkdownExportOptions,
} from "./markdown-export";
import {
  createEmptyWorkflow,
  createWorkflowStep,
  isWorkflowReady,
  parseAutomationWorkflows,
  readAutomationWorkflows,
  serializeAutomationWorkflows,
  serializeStoredAutomationWorkflows,
} from "./workflows";

describe("automation workflows", () => {
  it("parses pre-condition workflows as every note and drops malformed or removed steps", () => {
    const workflows = parseAutomationWorkflows(
      JSON.stringify([
        {
          id: "wf-1",
          title: "Recap",
          enabled: true,
          trigger: "meeting_completed",
          steps: [
            {
              id: "step-1",
              type: "markdown_export",
              directory: "/exports",
            },
            { id: "bad" },
            {
              id: "slack",
              type: "slack_recap",
              target: { id: "C1", name: "general" },
            },
            {
              id: "drive",
              type: "google_drive_export",
              connectionId: "connection",
              target: { id: "folder", name: "Notes" },
            },
          ],
          driveExports: [
            {
              sessionId: "session-1",
              stepId: "drive",
              connectionId: "connection",
              folderId: "folder",
              status: "success",
              detail: "https://drive.example/file",
              at: "2026-08-07T12:00:00.000Z",
            },
          ],
          lastRun: {
            at: "2026-08-07T12:00:00.000Z",
            status: "success",
            detail: "ok",
          },
          processedSessionIds: ["session-1", 2],
          chatGroupId: "group-1",
        },
        { title: "missing id" },
      ]),
    );

    expect(workflows).toEqual([
      {
        id: "wf-1",
        title: "Recap",
        enabled: true,
        trigger: "meeting_completed",
        conditions: { noteTypeId: null, noteSubtypeId: null },
        steps: [
          {
            id: "step-1",
            type: "markdown_export",
            directory: "/exports",
          },
        ],
        lastRun: {
          at: "2026-08-07T12:00:00.000Z",
          status: "success",
          detail: "ok",
        },
        processedSessionIds: ["session-1"],
        chatGroupId: "group-1",
      },
    ]);
  });

  it("keeps workflows an older build would misread out of the key it reads, preserving order", () => {
    const exportStep = {
      id: "md",
      type: "markdown_export" as const,
      directory: "~/Classes",
    };
    const legacy = createEmptyWorkflow({ id: "legacy", steps: [exportStep] });
    const named = createEmptyWorkflow({
      id: "named",
      trigger: "speakers_named",
      conditions: { noteTypeId: "class", noteSubtypeId: null },
      steps: [exportStep],
    });
    const stored = serializeStoredAutomationWorkflows([named, legacy]);

    expect(
      JSON.parse(stored.automation_workflows).map(
        (workflow: { id: string }) => workflow.id,
      ),
    ).toEqual(["legacy"]);
    expect(readAutomationWorkflows(stored)).toEqual([named, legacy]);

    // An older build prepends a workflow it created to the key it reads.
    const added = createEmptyWorkflow({ id: "added", steps: [exportStep] });
    const afterOlderBuild = {
      ...stored,
      automation_workflows: serializeAutomationWorkflows([added, legacy]),
    };
    expect(
      readAutomationWorkflows(afterOlderBuild).map((workflow) => workflow.id),
    ).toEqual(["added", "named", "legacy"]);

    const moved = serializeStoredAutomationWorkflows([
      { ...named, trigger: "note_enhanced", conditions: legacy.conditions },
      legacy,
    ]);
    expect(JSON.parse(moved.automation_workflows_extended).workflows).toEqual(
      [],
    );
    expect(
      readAutomationWorkflows(moved).map((workflow) => workflow.id),
    ).toEqual(["named", "legacy"]);

    const released = serializeAutomationWorkflows([legacy]);
    expect(readAutomationWorkflows({ automation_workflows: released })).toEqual(
      parseAutomationWorkflows(released),
    );
  });

  it("treats a workflow as ready only when every action is configured", () => {
    const configured = {
      ...createWorkflowStep("markdown_export"),
      directory: "/exports",
    };
    const workflow = createEmptyWorkflow({
      steps: [configured, createWorkflowStep("markdown_export")],
    });

    expect(isWorkflowReady(workflow)).toBe(false);

    workflow.steps = [configured];
    expect(isWorkflowReady(workflow)).toBe(true);
  });
});

describe("Markdown workflow options", () => {
  it("gives new actions explicit options instead of legacy export behavior", () => {
    const step = createWorkflowStep("markdown_export");
    expect(step).toMatchObject({ options: DEFAULT_MARKDOWN_EXPORT_OPTIONS });
    const workflow = createEmptyWorkflow({ steps: [step] });
    expect(
      parseAutomationWorkflows(serializeAutomationWorkflows([workflow])),
    ).toEqual([workflow]);
  });

  it.each(["", "   "])(
    "requires a folder with selected content: %j",
    (directory) => {
      const workflow = createEmptyWorkflow({
        steps: [
          {
            id: "export",
            type: "markdown_export",
            directory,
            options: DEFAULT_MARKDOWN_EXPORT_OPTIONS,
          },
        ],
      });
      expect(isWorkflowReady(workflow)).toBe(false);
    },
  );

  it("round-trips per-action selections and names independently", () => {
    const options = {
      ...DEFAULT_MARKDOWN_EXPORT_OPTIONS,
      include_memo: false,
      include_transcript: false,
      include_action_items: false,
      filename: "{date} Recap.md",
      include_id_suffix: false,
    };
    const workflow = createEmptyWorkflow({
      steps: [
        {
          id: "summary",
          type: "markdown_export",
          directory: "/exports",
          options,
        },
        {
          id: "all",
          type: "markdown_export",
          directory: "/archive",
          options: DEFAULT_MARKDOWN_EXPORT_OPTIONS,
        },
      ],
    });
    expect(
      parseAutomationWorkflows(serializeAutomationWorkflows([workflow])),
    ).toEqual([workflow]);
  });

  it("defaults malformed fields without losing explicit false values", () => {
    expect(
      parseMarkdownExportOptions({
        include_summary: false,
        include_memo: "false",
        filename: 42,
        include_id_suffix: false,
      }),
    ).toEqual({
      ...DEFAULT_MARKDOWN_EXPORT_OPTIONS,
      include_summary: false,
      include_id_suffix: false,
    });
    expect(parseMarkdownExportOptions(null)).toEqual(
      DEFAULT_MARKDOWN_EXPORT_OPTIONS,
    );
  });

  it("requires selected content while preserving legacy defaults", () => {
    const workflow = createEmptyWorkflow({
      steps: [
        {
          id: "export",
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
    });
    expect(isWorkflowReady(workflow)).toBe(false);
    workflow.steps = [
      { id: "legacy", type: "markdown_export", directory: "/exports" },
    ];
    expect(isWorkflowReady(workflow)).toBe(true);
  });
});
