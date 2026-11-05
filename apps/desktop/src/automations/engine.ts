import {
  commands as localApiCommands,
  type MarkdownExportFile,
  type MarkdownExportOptions,
} from "@anlg/plugin-local-api";

import { hasMarkdownExportContent } from "./markdown-export";
import { type AutomationRunRecord, parseAutomationRunRecord } from "./types";
import {
  type AutomationWorkflow,
  parseAutomationWorkflows,
  mutateAutomationWorkflows,
  type WorkflowStep,
  type WorkflowTrigger,
} from "./workflows";

import { getStoredSettingValues, setSettingValue } from "~/settings/queries";

export type { AutomationRunRecord };
export { parseAutomationRunRecord };

const MAX_PROCESSED_SESSIONS = 50;

export async function runMeetingCompletedAutomations(
  sessionId: string,
): Promise<void> {
  try {
    await runMarkdownExport(sessionId);
  } catch (error) {
    console.error("[automations] meeting.completed run failed", error);
  }
  try {
    await runCustomWorkflows(sessionId, "meeting_completed");
  } catch (error) {
    console.error("[automations] meeting.completed workflows failed", error);
  }
}

export async function runNoteEnhancedAutomations(
  sessionId: string,
): Promise<void> {
  try {
    await runCustomWorkflows(sessionId, "note_enhanced");
  } catch (error) {
    console.error("[automations] note.enhanced workflows failed", error);
  }
}

let workflowQueue: Promise<void> = Promise.resolve();
function enqueueWorkflowRun(run: () => Promise<void>): Promise<void> {
  const next = workflowQueue.then(run);
  workflowQueue = next.catch(() => {});
  return next;
}

function runCustomWorkflows(
  sessionId: string,
  trigger: WorkflowTrigger,
): Promise<void> {
  return enqueueWorkflowRun(() => runCustomWorkflowsNow(sessionId, trigger));
}

async function runCustomWorkflowsNow(
  sessionId: string,
  trigger: WorkflowTrigger,
): Promise<void> {
  const { values } = await getStoredSettingValues();
  const workflows = parseAutomationWorkflows(values.automation_workflows);
  for (const workflow of workflows) {
    if (!workflow.enabled || workflow.trigger !== trigger) {
      continue;
    }
    if (workflow.steps.length === 0) {
      continue;
    }
    if (trigger === "note_enhanced") {
      try {
        await runWorkflowWithFileExports(sessionId, workflow);
      } catch (error) {
        console.error("[automations] workflow run failed", error);
      }
      continue;
    }
    if (workflow.processedSessionIds.includes(sessionId)) {
      continue;
    }
    try {
      await runWorkflow(sessionId, workflow);
    } catch (error) {
      console.error("[automations] workflow run failed", error);
    }
  }
}

async function runWorkflow(
  sessionId: string,
  workflow: AutomationWorkflow,
): Promise<void> {
  const record: AutomationRunRecord = {
    at: new Date().toISOString(),
    status: "success",
    detail: "",
  };
  let markedSessionId: string | undefined;
  const markProcessed = async () => {
    markedSessionId = sessionId;
    await persistWorkflowResult(workflow.id, { sessionId });
  };
  try {
    const details: string[] = [];
    for (const step of workflow.steps) {
      details.push(
        await executeWorkflowStep(
          sessionId,
          step,
          workflowStepKey(workflow, step, sessionId),
        ),
      );
      await markProcessed();
    }
    record.detail = details.filter(Boolean).join(" · ") || "ok";
    await persistWorkflowResult(workflow.id, {
      record,
      sessionId,
    });
  } catch (error) {
    record.status = "error";
    record.detail = error instanceof Error ? error.message : String(error);
    console.error("[automations] workflow failed", error);
    await persistWorkflowResult(workflow.id, {
      record,
      sessionId: markedSessionId,
    });
  }
}

async function persistWorkflowResult(
  workflowId: string,
  {
    record,
    sessionId,
  }: {
    record?: AutomationRunRecord;
    sessionId?: string;
  },
): Promise<void> {
  await mutateAutomationWorkflows((workflows) =>
    workflows.map((workflow) => {
      if (workflow.id !== workflowId) return workflow;
      return {
        ...workflow,
        lastRun: record ?? workflow.lastRun,
        processedSessionIds: sessionId
          ? appendProcessedSession(workflow.processedSessionIds, sessionId)
          : workflow.processedSessionIds,
      };
    }),
  );
}

function appendProcessedSession(
  processed: string[],
  sessionId: string,
): string[] {
  if (processed.includes(sessionId)) {
    return processed;
  }
  return [...processed, sessionId].slice(-MAX_PROCESSED_SESSIONS);
}

async function executeWorkflowStep(
  sessionId: string,
  step: WorkflowStep,
  stepKey: string,
): Promise<string> {
  const directory = step.directory.trim();
  if (!directory) {
    throw new Error("choose an export folder first");
  }
  if (step.options && !hasMarkdownExportContent(step.options)) {
    throw new Error("choose at least one element to export");
  }
  return await executeConfiguredMarkdownExport(
    sessionId,
    directory,
    step.options,
    stepKey,
  );
}

async function runMarkdownExport(sessionId: string): Promise<void> {
  const { values } = await getStoredSettingValues();
  if (!values.automation_markdown_export_enabled) {
    return;
  }
  const directory = (values.automation_markdown_export_directory ?? "").trim();
  if (!directory) {
    return;
  }

  const record: AutomationRunRecord = {
    at: new Date().toISOString(),
    status: "success",
    detail: "",
  };
  try {
    record.detail = await executeMarkdownExport(sessionId, directory);
  } catch (error) {
    record.status = "error";
    record.detail = error instanceof Error ? error.message : String(error);
    console.error("[automations] markdown export failed", error);
  }
  await setSettingValue(
    "automation_markdown_export_last_run",
    JSON.stringify(record),
  );
}

async function executeMarkdownExport(
  sessionId: string,
  directory: string,
  options?: MarkdownExportOptions,
): Promise<string> {
  return (await exportMarkdownFile(sessionId, directory, options, null)).path;
}

async function exportMarkdownFile(
  sessionId: string,
  directory: string,
  options: MarkdownExportOptions | undefined,
  previous: MarkdownExportFile | null,
): Promise<MarkdownExportFile> {
  const result = await localApiCommands.exportMeetingMarkdown(
    sessionId,
    directory,
    options ?? null,
    previous,
  );
  if (result.status === "error") {
    throw new Error(result.error);
  }
  return result.data;
}

type StoredMarkdownExportFile = MarkdownExportFile & { key: string };

const MAX_MARKDOWN_EXPORT_FILES = 200;

function workflowStepKey(
  workflow: AutomationWorkflow,
  step: WorkflowStep,
  sessionId: string,
): string {
  return `${workflow.id}:${step.id}:${sessionId}`;
}

// A changed title renames the file, so the exporter replaces the one this step
// wrote last time unless another step now writes to that path.
async function executeConfiguredMarkdownExport(
  sessionId: string,
  directory: string,
  options: MarkdownExportOptions | undefined,
  key: string,
): Promise<string> {
  return await serializeSettingsUpdate(async () => {
    const { values } = await getStoredSettingValues();
    const files = parseMarkdownExportFiles(
      values.automation_markdown_export_files,
    );
    const others = files.filter((file) => file.key !== key);
    const previous = files.find((file) => file.key === key);
    const replaceable =
      previous &&
      !others.some(
        (file) => file.path.toLowerCase() === previous.path.toLowerCase(),
      )
        ? { path: previous.path, sha256: previous.sha256 }
        : null;
    const file = await exportMarkdownFile(
      sessionId,
      directory,
      options,
      replaceable,
    );
    await setSettingValue(
      "automation_markdown_export_files",
      JSON.stringify(
        [...others, { key, ...file }].slice(-MAX_MARKDOWN_EXPORT_FILES),
      ),
    );
    return file.path;
  });
}

let settingsUpdates: Promise<unknown> = Promise.resolve();

// Concurrent runs read and rewrite the same stored list, so run each
// read-modify-write after the previous one finishes.
function serializeSettingsUpdate<T>(update: () => Promise<T>): Promise<T> {
  const next = settingsUpdates.then(update, update);
  settingsUpdates = next.catch(() => undefined);
  return next;
}

function parseMarkdownExportFiles(
  value: string | undefined,
): StoredMarkdownExportFile[] {
  if (!value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is StoredMarkdownExportFile =>
            typeof entry === "object" &&
            entry !== null &&
            ["key", "path", "sha256"].every(
              (field) =>
                typeof (entry as Record<string, unknown>)[field] === "string",
            ),
        )
      : [];
  } catch {
    return [];
  }
}

// Markdown exports overwrite the same file, so summary-ready workflows rerun
// on every regenerated summary.
async function runWorkflowWithFileExports(
  sessionId: string,
  workflow: AutomationWorkflow,
): Promise<void> {
  const record: AutomationRunRecord = {
    at: new Date().toISOString(),
    status: "success",
    detail: "",
  };
  const details: string[] = [];
  for (const step of workflow.steps) {
    try {
      details.push(
        await executeWorkflowStep(
          sessionId,
          step,
          workflowStepKey(workflow, step, sessionId),
        ),
      );
      await persistWorkflowResult(workflow.id, { sessionId });
    } catch (error) {
      record.status = "error";
      details.push(error instanceof Error ? error.message : String(error));
      break;
    }
  }
  record.detail = details.join(" · ");
  await persistWorkflowResult(workflow.id, { record });
}
