import { t } from "@lingui/core/macro";

import type { MarkdownExportOptions } from "@anlg/plugin-local-api";

import {
  DEFAULT_MARKDOWN_EXPORT_OPTIONS,
  hasMarkdownExportContent,
  parseMarkdownExportOptions,
} from "./markdown-export";
import type { AutomationRunRecord } from "./types";

import type { NoteTypeSelection } from "~/note-types/queries";
import {
  getStoredSettingValues,
  setSettingValue,
  useStoredSettingValue,
} from "~/settings/queries";
import { id } from "~/shared/utils";

const WORKFLOW_TRIGGERS = [
  "note_enhanced",
  "meeting_completed",
  "speakers_named",
] as const;
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];

export type WorkflowStep =
  | {
      id: string;
      type: "markdown_export";
      directory: string;
      options?: MarkdownExportOptions;
    }
  | { id: string; type: "summary_template"; templateId: string }
  | { id: string; type: "regenerate_summary" }
  | { id: string; type: "move_to_folder"; folderPath: string };

export type WorkflowStepType = WorkflowStep["type"];

export type AutomationWorkflow = {
  id: string;
  title: string;
  enabled: boolean;
  trigger: WorkflowTrigger;
  conditions: { noteTypeId: string | null; noteSubtypeId: string | null };
  steps: WorkflowStep[];
  lastRun: AutomationRunRecord | null;
  processedSessionIds: string[];
  chatGroupId: string | null;
};

export function createEmptyWorkflow(
  overrides: Partial<AutomationWorkflow> = {},
): AutomationWorkflow {
  return {
    id: overrides.id ?? id(),
    title: overrides.title ?? t`Untitled automation`,
    enabled: overrides.enabled ?? false,
    trigger: overrides.trigger ?? "note_enhanced",
    conditions: overrides.conditions ?? EVERY_NOTE,
    steps: overrides.steps ?? [],
    lastRun: overrides.lastRun ?? null,
    processedSessionIds: overrides.processedSessionIds ?? [],
    chatGroupId: overrides.chatGroupId ?? null,
  };
}

const EVERY_NOTE: AutomationWorkflow["conditions"] = {
  noteTypeId: null,
  noteSubtypeId: null,
};

export function createWorkflowStep(type: WorkflowStepType): WorkflowStep {
  switch (type) {
    case "markdown_export":
      return {
        id: id(),
        type,
        directory: "",
        options: { ...DEFAULT_MARKDOWN_EXPORT_OPTIONS },
      };
    case "summary_template":
      return { id: id(), type, templateId: "" };
    case "regenerate_summary":
      return { id: id(), type };
    case "move_to_folder":
      return { id: id(), type, folderPath: "" };
  }
}

// The template step is read when a summary is generated, so it belongs to the
// flow that precedes the first summary. Regenerating from a summary-ready flow
// would trigger itself again.
export function isStepAllowedForTrigger(
  type: WorkflowStepType,
  trigger: WorkflowTrigger,
): boolean {
  switch (type) {
    case "summary_template":
      return trigger === "meeting_completed";
    case "regenerate_summary":
      return trigger !== "note_enhanced";
    default:
      return true;
  }
}

export function isWorkflowStepReady(step: WorkflowStep): boolean {
  switch (step.type) {
    case "markdown_export":
      return (
        step.directory.trim().length > 0 &&
        hasMarkdownExportContent(
          step.options ?? DEFAULT_MARKDOWN_EXPORT_OPTIONS,
        )
      );
    case "summary_template":
      return step.templateId.length > 0;
    case "regenerate_summary":
      return true;
    case "move_to_folder":
      return step.folderPath.trim().length > 0;
  }
}

export function isWorkflowReady(workflow: AutomationWorkflow): boolean {
  return (
    workflow.steps.length > 0 &&
    workflow.steps.every(
      (step) =>
        isWorkflowStepReady(step) &&
        isStepAllowedForTrigger(step.type, workflow.trigger),
    )
  );
}

export function workflowMatchesNote(
  conditions: AutomationWorkflow["conditions"],
  note: NoteTypeSelection,
): boolean {
  return (
    (conditions.noteTypeId === null || conditions.noteTypeId === note.typeId) &&
    (conditions.noteSubtypeId === null ||
      conditions.noteSubtypeId === note.subtypeId)
  );
}

// Most specific first: subtype, then type, then every note; list order breaks
// ties.
export function workflowSummaryTemplateIds(
  workflows: AutomationWorkflow[],
  note: NoteTypeSelection,
): string[] {
  return workflows
    .filter(
      (workflow) =>
        workflow.enabled &&
        isStepAllowedForTrigger("summary_template", workflow.trigger) &&
        workflowMatchesNote(workflow.conditions, note),
    )
    .map((workflow, index) => ({
      index,
      specificity: workflow.conditions.noteSubtypeId
        ? 2
        : workflow.conditions.noteTypeId
          ? 1
          : 0,
      templateIds: workflow.steps.flatMap((step) =>
        step.type === "summary_template" && step.templateId
          ? [step.templateId]
          : [],
      ),
    }))
    .sort(
      (left, right) =>
        right.specificity - left.specificity || left.index - right.index,
    )
    .flatMap((candidate) => candidate.templateIds);
}

export function parseAutomationWorkflows(
  value: string | undefined,
): AutomationWorkflow[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((item) => {
      const workflow = parseWorkflow(item);
      return workflow ? [workflow] : [];
    });
  } catch {
    return [];
  }
}

export function serializeAutomationWorkflows(
  workflows: AutomationWorkflow[],
): string {
  return JSON.stringify(workflows);
}

export async function saveAutomationWorkflows(
  workflows: AutomationWorkflow[],
): Promise<void> {
  await setSettingValue(
    "automation_workflows",
    serializeAutomationWorkflows(workflows),
  );
}

export function useAutomationWorkflows(): AutomationWorkflow[] {
  return parseAutomationWorkflows(
    useStoredSettingValue("automation_workflows").value,
  );
}

function parseWorkflow(value: unknown): AutomationWorkflow | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  const trigger =
    WORKFLOW_TRIGGERS.find((candidate) => candidate === value.trigger) ??
    "note_enhanced";
  const steps = Array.isArray(value.steps)
    ? value.steps.flatMap((step) => {
        const parsed = parseStep(step);
        return parsed ? [parsed] : [];
      })
    : [];

  return {
    id: value.id,
    title:
      typeof value.title === "string" ? value.title : t`Untitled automation`,
    enabled: value.enabled === true,
    trigger,
    conditions: parseConditions(value.conditions),
    steps,
    lastRun: parseLastRun(value.lastRun),
    processedSessionIds: Array.isArray(value.processedSessionIds)
      ? value.processedSessionIds.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    chatGroupId:
      typeof value.chatGroupId === "string" ? value.chatGroupId : null,
  };
}

function parseStep(value: unknown): WorkflowStep | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }
  if (value.type === "markdown_export") {
    return {
      id: value.id,
      type: "markdown_export",
      directory: typeof value.directory === "string" ? value.directory : "",
      ...(value.options !== undefined
        ? { options: parseMarkdownExportOptions(value.options) }
        : {}),
    };
  }
  if (value.type === "summary_template") {
    return {
      id: value.id,
      type: "summary_template",
      templateId: typeof value.templateId === "string" ? value.templateId : "",
    };
  }
  if (value.type === "regenerate_summary") {
    return { id: value.id, type: "regenerate_summary" };
  }
  if (value.type === "move_to_folder") {
    return {
      id: value.id,
      type: "move_to_folder",
      folderPath: typeof value.folderPath === "string" ? value.folderPath : "",
    };
  }
  return null;
}

function parseConditions(value: unknown): AutomationWorkflow["conditions"] {
  if (
    !isRecord(value) ||
    typeof value.noteTypeId !== "string" ||
    !value.noteTypeId
  ) {
    return EVERY_NOTE;
  }
  return {
    noteTypeId: value.noteTypeId,
    noteSubtypeId:
      typeof value.noteSubtypeId === "string" && value.noteSubtypeId
        ? value.noteSubtypeId
        : null,
  };
}

function parseLastRun(value: unknown): AutomationRunRecord | null {
  if (
    isRecord(value) &&
    typeof value.at === "string" &&
    (value.status === "success" || value.status === "error") &&
    typeof value.detail === "string"
  ) {
    return {
      at: value.at,
      status: value.status,
      detail: value.detail,
    };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

let workflowWriteQueue: Promise<void> = Promise.resolve();

export function mutateAutomationWorkflows(
  update: (workflows: AutomationWorkflow[]) => AutomationWorkflow[],
): Promise<void> {
  const next = workflowWriteQueue.then(async () => {
    const { values } = await getStoredSettingValues();
    await setSettingValue(
      "automation_workflows",
      serializeAutomationWorkflows(
        update(parseAutomationWorkflows(values.automation_workflows)),
      ),
    );
  });
  workflowWriteQueue = next.catch(() => {});
  return next;
}
