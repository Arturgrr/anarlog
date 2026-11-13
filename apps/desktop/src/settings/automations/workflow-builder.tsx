import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";

import { ArrowRight, Plus, Trash } from "@anlg/ui/components/icons";
import { Badge } from "@anlg/ui/components/ui/badge";
import { Button } from "@anlg/ui/components/ui/button";
import {
  AppFloatingPanel,
  appFloatingMenuPanelClassName,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@anlg/ui/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@anlg/ui/components/ui/select";
import { toast } from "@anlg/ui/components/ui/toast";
import { cn } from "@anlg/utils";

import { MarkdownExportOptionsConfig } from "./markdown-export-options";
import { AutomationLastRunLine, MarkdownExportConfig } from "./starter-config";

import { DEFAULT_MARKDOWN_EXPORT_OPTIONS } from "~/automations/markdown-export";
import {
  createWorkflowStep,
  isStepAllowedForTrigger,
  isWorkflowReady,
  isWorkflowStepReady,
  type AutomationWorkflow,
  type WorkflowStep,
  type WorkflowStepType,
  type WorkflowTrigger,
} from "~/automations/workflows";
import { NoteTypePicker } from "~/note-types/picker";
import { useNoteTypes } from "~/note-types/queries";
import { useFolderPaths } from "~/session/queries/folders";
import { useUserTemplates } from "~/templates/queries";

const STEP_TYPES: WorkflowStepType[] = [
  "markdown_export",
  "summary_template",
  "regenerate_summary",
  "move_to_folder",
];

export function WorkflowBuilder({
  workflow,
  onChange,
}: {
  workflow: AutomationWorkflow;
  onChange: (workflow: AutomationWorkflow) => void;
}) {
  const { t } = useLingui();

  const update = (patch: Partial<AutomationWorkflow>) => {
    onChange({ ...workflow, ...patch });
  };

  const updateStep = (stepId: string, next: WorkflowStep) => {
    update({
      steps: workflow.steps.map((step) => (step.id === stepId ? next : step)),
    });
  };

  const addStep = (type: WorkflowStepType) => {
    update({ steps: [...workflow.steps, createWorkflowStep(type)] });
  };

  const removeStep = (stepId: string) => {
    update({ steps: workflow.steps.filter((step) => step.id !== stepId) });
  };

  return (
    <section
      className="bg-card shadow-raised overflow-hidden rounded-lg"
      aria-labelledby="workflow-builder-title"
    >
      <div className="border-border flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3
              id="workflow-builder-title"
              className="truncate text-sm font-semibold"
            >
              <Trans>Workflow</Trans>
            </h3>
            {workflow.enabled ? (
              <Badge variant="outline">
                <Trans>Enabled</Trans>
              </Badge>
            ) : (
              <Badge variant="outline">
                <Trans>Draft</Trans>
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            <Trans>Add a trigger, then stack actions like Zapier.</Trans>
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 p-5">
        <WorkflowCard
          kind="trigger"
          title={t`When this happens`}
          badge={<Trans>Trigger</Trans>}
        >
          <Select
            value={workflow.trigger}
            onValueChange={(value) =>
              update({ trigger: value as WorkflowTrigger })
            }
          >
            <SelectTrigger className="h-7 w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="note_enhanced">
                <Trans>After the meeting summary is ready</Trans>
              </SelectItem>
              <SelectItem value="meeting_completed">
                <Trans>After the meeting ends</Trans>
              </SelectItem>
              <SelectItem value="speakers_named">
                <Trans>After every speaker is named</Trans>
              </SelectItem>
            </SelectContent>
          </Select>
          {workflow.trigger === "speakers_named" ? (
            <p className="text-muted-foreground mt-2 text-xs">
              <Trans>
                Runs once per note, when you name its last unnamed speaker.
              </Trans>
            </p>
          ) : null}
          <WorkflowConditionsConfig
            conditions={workflow.conditions}
            onChange={(conditions) => update({ conditions })}
          />
        </WorkflowCard>

        {workflow.steps.map((step, index) => (
          <div key={step.id}>
            <div className="text-muted-foreground flex h-6 items-center pl-6">
              <ArrowRight className="rotate-90" size={13} />
            </div>
            <WorkflowCard
              kind="action"
              title={t`Then ${index + 1}`}
              badge={<Trans>Action</Trans>}
              ready={
                isWorkflowStepReady(step) &&
                isStepAllowedForTrigger(step.type, workflow.trigger)
              }
              onRemove={() => removeStep(step.id)}
            >
              <p className="text-xs">
                <WorkflowStepLabel type={step.type} />
              </p>
              {!isStepAllowedForTrigger(step.type, workflow.trigger) ? (
                <p role="alert" className="text-destructive mt-2 text-xs">
                  <Trans>
                    This action is not available for this trigger. Remove it or
                    choose another trigger.
                  </Trans>
                </p>
              ) : null}
              <div className="mt-3">
                <WorkflowStepConfig
                  step={step}
                  onChange={(next) => updateStep(step.id, next)}
                />
              </div>
            </WorkflowCard>
          </div>
        ))}

        <div className="text-muted-foreground flex h-6 items-center pl-6">
          <ArrowRight className="rotate-90" size={13} />
        </div>

        <AddWorkflowStep
          types={STEP_TYPES.filter((type) =>
            isStepAllowedForTrigger(type, workflow.trigger),
          )}
          onAdd={addStep}
        />
      </div>

      <div className="border-border border-t px-5 py-4">
        {!isWorkflowReady(workflow) ? (
          <p className="text-muted-foreground text-xs">
            <Trans>Add at least one configured action before enabling.</Trans>
          </p>
        ) : null}
        <AutomationLastRunLine lastRun={workflow.lastRun} />
      </div>
    </section>
  );
}

function WorkflowConditionsConfig({
  conditions,
  onChange,
}: {
  conditions: AutomationWorkflow["conditions"];
  onChange: (conditions: AutomationWorkflow["conditions"]) => void;
}) {
  const noteTypes = useNoteTypes();
  const missing =
    conditions.noteTypeId !== null &&
    !noteTypes.some((type) => type.id === conditions.noteTypeId);

  return (
    <div className="mt-4 flex flex-col gap-2">
      <h4 className="text-xs font-semibold">
        <Trans>Applies to</Trans>
      </h4>
      <div className="max-w-xs">
        <NoteTypePicker
          value={{
            typeId: conditions.noteTypeId,
            subtypeId: conditions.noteSubtypeId,
          }}
          onChange={(next) =>
            onChange({
              noteTypeId: next.typeId,
              noteSubtypeId: next.typeId ? next.subtypeId : null,
            })
          }
        />
      </div>
      <p
        className={cn([
          "text-xs",
          missing ? "text-destructive" : "text-muted-foreground",
        ])}
      >
        {missing ? (
          <Trans>
            The note type this automation applied to was deleted, so it matches
            no note. Choose another type or clear it.
          </Trans>
        ) : conditions.noteTypeId === null ? (
          <Trans>Every note. Choose a type to run only for those notes.</Trans>
        ) : conditions.noteSubtypeId === null ? (
          <Trans>Notes of this type, whatever their subtype.</Trans>
        ) : (
          <Trans>Only notes of this subtype.</Trans>
        )}
      </p>
    </div>
  );
}

function WorkflowStepLabel({ type }: { type: WorkflowStepType }) {
  switch (type) {
    case "markdown_export":
      return <Trans>Export the meeting as Markdown</Trans>;
    case "summary_template":
      return <Trans>Use a summary template</Trans>;
    case "regenerate_summary":
      return <Trans>Regenerate the summary</Trans>;
    case "move_to_folder":
      return <Trans>Move the note to a folder</Trans>;
  }
}

function WorkflowStepConfig({
  step,
  onChange,
}: {
  step: WorkflowStep;
  onChange: (step: WorkflowStep) => void;
}) {
  switch (step.type) {
    case "markdown_export":
      return (
        <>
          <MarkdownExportConfig
            value={step.directory}
            onChange={(directory) => onChange({ ...step, directory })}
          />
          <MarkdownExportOptionsConfig
            options={step.options ?? DEFAULT_MARKDOWN_EXPORT_OPTIONS}
            onChange={(options) => onChange({ ...step, options })}
          />
        </>
      );
    case "summary_template":
      return (
        <SummaryTemplateConfig
          templateId={step.templateId}
          onChange={(templateId) => onChange({ ...step, templateId })}
        />
      );
    case "regenerate_summary":
      return (
        <p className="text-muted-foreground text-xs">
          <Trans>
            Generates the note's summary again, for example so it uses the names
            you just gave the speakers.
          </Trans>
        </p>
      );
    case "move_to_folder":
      return (
        <MoveToFolderConfig
          folderPath={step.folderPath}
          onChange={(folderPath) => onChange({ ...step, folderPath })}
        />
      );
  }
}

function SummaryTemplateConfig({
  templateId,
  onChange,
}: {
  templateId: string;
  onChange: (templateId: string) => void;
}) {
  const { t } = useLingui();
  const templates = useUserTemplates();
  const missing =
    templateId.length > 0 &&
    !templates.some((template) => template.id === templateId);

  return (
    <div className="flex flex-col gap-2">
      <Select value={templateId || undefined} onValueChange={onChange}>
        <SelectTrigger className="h-7 w-full max-w-xs">
          <SelectValue placeholder={t`Choose a template`} />
        </SelectTrigger>
        <SelectContent>
          {missing ? (
            <SelectItem value={templateId} disabled>
              {t`Deleted template`}
            </SelectItem>
          ) : null}
          {templates.map((template) => (
            <SelectItem key={template.id} value={template.id}>
              {template.title || t`Untitled template`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p
        className={cn([
          "text-xs",
          missing ? "text-destructive" : "text-muted-foreground",
        ])}
      >
        {missing ? (
          <Trans>
            This template was deleted, so summaries fall back to the default
            template.
          </Trans>
        ) : (
          <Trans>
            Used whenever Librelog creates this note's summary. A template
            chosen in the note itself comes first, and a summary that already
            exists keeps its template when it is regenerated.
          </Trans>
        )}
      </p>
    </div>
  );
}

function MoveToFolderConfig({
  folderPath,
  onChange,
}: {
  folderPath: string;
  onChange: (folderPath: string) => void;
}) {
  const { t } = useLingui();
  const folderPaths = useFolderPaths();
  const missing = folderPath.length > 0 && !folderPaths.includes(folderPath);

  return (
    <div className="flex flex-col gap-2">
      <Select value={folderPath || undefined} onValueChange={onChange}>
        <SelectTrigger className="h-7 w-full max-w-xs">
          <SelectValue placeholder={t`Choose a folder`} />
        </SelectTrigger>
        <SelectContent>
          {missing ? (
            <SelectItem value={folderPath} disabled>
              {folderPath}
            </SelectItem>
          ) : null}
          {folderPaths.map((path) => (
            <SelectItem key={path} value={path}>
              {path}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {missing ? (
        <p role="alert" className="text-destructive text-xs">
          <Trans>This folder no longer exists. Choose another one.</Trans>
        </p>
      ) : folderPaths.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          <Trans>Create a folder in the sidebar first.</Trans>
        </p>
      ) : null}
    </div>
  );
}

function AddWorkflowStep({
  types,
  onAdd,
}: {
  types: WorkflowStepType[];
  onAdd: (type: WorkflowStepType) => void;
}) {
  return (
    <div className="border-border bg-muted/20 flex items-center justify-between gap-3 rounded-xl border border-dashed p-4">
      <div>
        <p className="text-sm font-medium">
          <Trans>Add an action</Trans>
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          <Trans>Stack another destination. Steps run top to bottom.</Trans>
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
          >
            <Plus size={12} />
            <Trans>Add step</Trans>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent variant="app" align="end">
          <AppFloatingPanel className={appFloatingMenuPanelClassName}>
            {types.map((type) => (
              <DropdownMenuItem
                key={type}
                onClick={() => onAdd(type)}
                className="cursor-pointer"
              >
                <WorkflowStepLabel type={type} />
              </DropdownMenuItem>
            ))}
          </AppFloatingPanel>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function WorkflowCard({
  kind,
  title,
  badge,
  ready = true,
  onRemove,
  children,
}: {
  kind: "trigger" | "action";
  title: string;
  badge: React.ReactNode;
  ready?: boolean;
  onRemove?: () => void;
  children: React.ReactNode;
}) {
  const { t } = useLingui();

  return (
    <div className="border-border bg-card flex items-start gap-3 rounded-xl border p-4">
      <span
        className={cn([
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          kind === "trigger"
            ? "bg-contrast text-primary-foreground"
            : "bg-layer-2 text-foreground",
        ])}
      >
        {kind === "trigger" ? "1" : "+"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          <Badge variant="outline" size="sm">
            {badge}
          </Badge>
          {!ready ? (
            <Badge variant="outline" size="sm">
              <Trans>Needs setup</Trans>
            </Badge>
          ) : null}
          {onRemove ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="text-muted-foreground ml-auto size-7"
              onClick={onRemove}
              aria-label={t`Remove step`}
            >
              <Trash size={13} />
            </Button>
          ) : null}
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

export function useSaveWorkflow() {
  const { t } = useLingui();
  return useMutation({
    mutationKey: ["automation-workflow-save"],
    mutationFn: async ({
      next,
    }: {
      workflows: AutomationWorkflow[];
      next: AutomationWorkflow;
    }) => {
      const { mutateAutomationWorkflows } =
        await import("~/automations/workflows");
      next = { ...next, enabled: next.enabled && isWorkflowReady(next) };
      await mutateAutomationWorkflows((current) => {
        const existing = current.find((workflow) => workflow.id === next.id);
        const updated = existing
          ? {
              ...next,
              lastRun: existing.lastRun,
              processedSessionIds: existing.processedSessionIds,
            }
          : next;
        return existing
          ? current.map((workflow) =>
              workflow.id === next.id ? updated : workflow,
            )
          : [updated, ...current];
      });
    },
    onError: () => toast.error(t`Could not update the automation`),
  });
}
