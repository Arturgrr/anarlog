import { t } from "@lingui/core/macro";

import type { MarkdownExportOptions } from "@anlg/plugin-local-api";

import {
  DEFAULT_MARKDOWN_EXPORT_OPTIONS,
  hasMarkdownExportContent,
  parseMarkdownExportOptions,
} from "./markdown-export";
import type { AutomationRunRecord } from "./types";

import {
  getStoredSettingValues,
  setSettingValue,
  useStoredSettingValue,
} from "~/settings/queries";
import { id } from "~/shared/utils";

const WORKFLOW_TRIGGERS = ["note_enhanced", "meeting_completed"] as const;
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];

export type WorkflowStepType = "markdown_export";

export type WorkflowStep = {
  id: string;
  type: "markdown_export";
  directory: string;
  options?: MarkdownExportOptions;
};

export type AutomationWorkflow = {
  id: string;
  title: string;
  enabled: boolean;
  trigger: WorkflowTrigger;
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
    steps: overrides.steps ?? [],
    lastRun: overrides.lastRun ?? null,
    processedSessionIds: overrides.processedSessionIds ?? [],
    chatGroupId: overrides.chatGroupId ?? null,
  };
}

export function createWorkflowStep(type: WorkflowStepType): WorkflowStep {
  return {
    id: id(),
    type,
    directory: "",
    options: { ...DEFAULT_MARKDOWN_EXPORT_OPTIONS },
  };
}

export function isWorkflowStepReady(step: WorkflowStep): boolean {
  return (
    step.directory.trim().length > 0 &&
    hasMarkdownExportContent(step.options ?? DEFAULT_MARKDOWN_EXPORT_OPTIONS)
  );
}

export function isWorkflowReady(workflow: AutomationWorkflow): boolean {
  return workflow.steps.length > 0 && workflow.steps.every(isWorkflowStepReady);
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
    value.trigger === "meeting_completed"
      ? "meeting_completed"
      : "note_enhanced";
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
  return null;
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
