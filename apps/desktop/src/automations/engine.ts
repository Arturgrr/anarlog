import { t } from "@lingui/core/macro";

import {
  commands as localApiCommands,
  type MarkdownExportFile,
  type MarkdownExportOptions,
} from "@anlg/plugin-local-api";

import { hasMarkdownExportContent } from "./markdown-export";
import { type AutomationRunRecord, parseAutomationRunRecord } from "./types";
import {
  type AutomationWorkflow,
  isStepAllowedForTrigger,
  parseAutomationWorkflows,
  mutateAutomationWorkflows,
  workflowMatchesNote,
  type WorkflowStep,
  type WorkflowTrigger,
} from "./workflows";

import {
  getSessionNoteType,
  type NoteTypeSelection,
} from "~/note-types/queries";
import { normalizeFolderPath } from "~/session/folders";
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

export async function runSpeakersNamedAutomations(
  sessionId: string,
): Promise<void> {
  try {
    await runCustomWorkflows(sessionId, "speakers_named");
  } catch (error) {
    console.error("[automations] speakers.named workflows failed", error);
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
  const workflows = parseAutomationWorkflows(
    values.automation_workflows,
  ).filter(
    (workflow) =>
      workflow.enabled &&
      workflow.trigger === trigger &&
      workflow.steps.some((step) => isRunnableStep(step, trigger)),
  );
  let note: NoteTypeSelection | undefined;
  for (const workflow of workflows) {
    if (workflow.conditions.noteTypeId !== null) {
      note ??= await getSessionNoteType(sessionId);
      if (!workflowMatchesNote(workflow.conditions, note)) {
        continue;
      }
    }
    // Markdown exports overwrite the same file, so summary-ready workflows
    // rerun on every regenerated summary.
    if (
      trigger !== "note_enhanced" &&
      workflow.processedSessionIds.includes(sessionId)
    ) {
      continue;
    }
    try {
      await runWorkflow(sessionId, workflow, trigger);
    } catch (error) {
      console.error("[automations] workflow run failed", error);
    }
  }
}

function isRunnableStep(step: WorkflowStep, trigger: WorkflowTrigger) {
  return (
    step.type !== "summary_template" &&
    isStepAllowedForTrigger(step.type, trigger)
  );
}

// A failed Markdown export stops the workflow, as it always has; other steps
// are independent, so the rest still run. Any successful step marks the note
// processed, so a run where every step failed can be retried.
async function runWorkflow(
  sessionId: string,
  workflow: AutomationWorkflow,
  trigger: WorkflowTrigger,
): Promise<void> {
  const record: AutomationRunRecord = {
    at: new Date().toISOString(),
    status: "success",
    detail: "",
  };
  const details: string[] = [];
  for (const step of workflow.steps) {
    if (!isRunnableStep(step, trigger)) {
      continue;
    }
    try {
      details.push(await executeWorkflowStep(sessionId, workflow, step));
      await persistWorkflowResult(workflow.id, { sessionId });
    } catch (error) {
      record.status = "error";
      details.push(error instanceof Error ? error.message : String(error));
      console.error("[automations] workflow step failed", error);
      if (step.type === "markdown_export") {
        break;
      }
    }
  }
  record.detail = details.filter(Boolean).join(" · ") || "ok";
  await persistWorkflowResult(workflow.id, { record });
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
  workflow: AutomationWorkflow,
  step: WorkflowStep,
): Promise<string> {
  switch (step.type) {
    case "markdown_export":
      return executeMarkdownExportStep(
        sessionId,
        step,
        workflowStepKey(workflow, step, sessionId),
      );
    case "regenerate_summary":
      return regenerateSummary(sessionId);
    case "move_to_folder":
      return moveToFolder(sessionId, step.folderPath);
    case "summary_template":
      return "";
  }
}

async function regenerateSummary(sessionId: string): Promise<string> {
  const { getEnhancerService } = await import("~/services/enhancer");
  const service = getEnhancerService();
  if (service) {
    await service.requestAutoEnhance(sessionId, "regenerate");
  } else {
    const { requestMainAutoEnhance } = await import("~/ai/task-window-sync");
    await requestMainAutoEnhance(sessionId, "regenerate");
  }
  return t`summary regeneration requested`;
}

async function moveToFolder(
  sessionId: string,
  folderPath: string,
): Promise<string> {
  const path = normalizeFolderPath(folderPath);
  if (!path) {
    throw new Error(t`choose a folder first`);
  }
  const [{ loadFolderPaths }, { updateSession }] = await Promise.all([
    import("~/session/queries/folders"),
    import("~/session/queries/sessions"),
  ]);
  if (!(await loadFolderPaths()).includes(path)) {
    throw new Error(t`folder ${path} no longer exists`);
  }
  await updateSession(sessionId, { folder_id: path });
  return t`moved to ${path}`;
}

async function executeMarkdownExportStep(
  sessionId: string,
  step: Extract<WorkflowStep, { type: "markdown_export" }>,
  stepKey: string,
): Promise<string> {
  const directory = step.directory.trim();
  if (!directory) {
    throw new Error(t`choose an export folder first`);
  }
  if (step.options && !hasMarkdownExportContent(step.options)) {
    throw new Error(t`choose at least one element to export`);
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
