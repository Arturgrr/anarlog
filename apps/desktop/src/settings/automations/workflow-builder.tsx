import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";

import { ArrowRight, Plus, Trash } from "@anlg/ui/components/icons";
import { Badge } from "@anlg/ui/components/ui/badge";
import { Button } from "@anlg/ui/components/ui/button";
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
  isWorkflowReady,
  isWorkflowStepReady,
  type AutomationWorkflow,
  type WorkflowStep,
  type WorkflowTrigger,
} from "~/automations/workflows";

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

  const addStep = () => {
    update({
      steps: [...workflow.steps, createWorkflowStep("markdown_export")],
    });
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
            </SelectContent>
          </Select>
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
              ready={isWorkflowStepReady(step)}
              onRemove={() => removeStep(step.id)}
            >
              <p className="text-xs">
                <Trans>Export the meeting as Markdown</Trans>
              </p>
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

        <AddWorkflowStep onAdd={addStep} />
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

function WorkflowStepConfig({
  step,
  onChange,
}: {
  step: WorkflowStep;
  onChange: (step: WorkflowStep) => void;
}) {
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
}

function AddWorkflowStep({ onAdd }: { onAdd: () => void }) {
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
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={onAdd}
      >
        <Plus size={12} />
        <Trans>Add step</Trans>
      </Button>
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
