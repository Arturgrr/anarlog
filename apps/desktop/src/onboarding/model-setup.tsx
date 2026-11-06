import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";

import { CircleNotch } from "@anlg/ui/components/icons";
import { cn } from "@anlg/utils";

import {
  type ModelSetupStatus,
  useIntelligenceSetup,
  useTranscriptionSetup,
} from "./model-status";
import { OnboardingButton } from "./shared";

import { LlmModelPicker } from "~/settings/ai/llm";
import { SttModelPicker } from "~/settings/ai/stt";
import { formatDownloadProgress } from "~/settings/ai/stt/shared";
import { SettingsHydrationBoundary } from "~/settings/hydration-boundary";

export function TranscriptionStep({ onContinue }: { onContinue: () => void }) {
  const status = useTranscriptionSetup();
  const canContinue = status.kind === "ready" || status.kind === "installing";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <SettingsHydrationBoundary>
        <SttModelPicker variant="embedded" />
      </SettingsHydrationBoundary>
      <StepFooter
        status={<ChosenModel status={status} />}
        actions={
          <OnboardingButton disabled={!canContinue} onClick={onContinue}>
            <Trans>Continue to Intelligence</Trans>
          </OnboardingButton>
        }
      />
    </div>
  );
}

export function IntelligenceStep({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: () => void;
}) {
  const status = useIntelligenceSetup();
  const transcription = useTranscriptionSetup();
  const canContinue = status.kind === "ready" && transcription.kind === "ready";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <SettingsHydrationBoundary>
        <LlmModelPicker variant="embedded" />
      </SettingsHydrationBoundary>
      <StepFooter
        status={
          <>
            <ChosenModel status={status} />
            <TranscriptionBlocker status={transcription} />
          </>
        }
        actions={
          <>
            <OnboardingButton variant="ghost" onClick={onBack}>
              <Trans>Back</Trans>
            </OnboardingButton>
            <OnboardingButton disabled={!canContinue} onClick={onContinue}>
              <Trans>Continue</Trans>
            </OnboardingButton>
          </>
        }
      />
    </div>
  );
}

export function TranscriptionSummary() {
  const status = useTranscriptionSetup();
  return (
    <Trans>
      Transcription: <StatusSummary status={status} />
    </Trans>
  );
}

export function IntelligenceSummary() {
  const status = useIntelligenceSetup();
  return (
    <Trans>
      Intelligence: <StatusSummary status={status} />
    </Trans>
  );
}

function StepFooter({
  status,
  actions,
}: {
  status: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div
        role="status"
        className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1 text-sm"
      >
        {status}
      </div>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </div>
  );
}

function ChosenModel({ status }: { status: ModelSetupStatus }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <StatusDot status={status} />
      {status.kind === "none" ? (
        <span className="text-muted-foreground">
          <Trans>Choose a model to continue</Trans>
        </span>
      ) : (
        <span className="min-w-0 break-words">
          <span className="text-faint">
            <Trans>Chosen:</Trans>
          </span>{" "}
          {modelAndProvider(status)} · <StateLabel status={status} />
        </span>
      )}
    </span>
  );
}

function TranscriptionBlocker({ status }: { status: ModelSetupStatus }) {
  if (status.kind === "ready") {
    return null;
  }

  if (status.kind === "installing") {
    const percent = formatDownloadProgress(status.progress);
    return (
      <span className="text-muted-foreground flex items-center gap-2">
        <CircleNotch className="size-3.5 shrink-0 animate-spin" aria-hidden />
        {percent ? (
          <Trans>
            Waiting for transcription to finish installing ({percent})
          </Trans>
        ) : (
          <Trans>Waiting for transcription to finish installing</Trans>
        )}
      </span>
    );
  }

  return (
    <span
      className={cn([
        "min-w-0 break-words",
        status.kind === "error" ? "text-danger" : "text-muted-foreground",
      ])}
    >
      {status.kind === "none" ? (
        <Trans>Transcription isn’t set up yet.</Trans>
      ) : (
        <Trans>Transcription isn’t ready: {status.message}</Trans>
      )}
    </span>
  );
}

function StatusSummary({ status }: { status: ModelSetupStatus }) {
  if (status.kind === "none") {
    return <Trans>not set up</Trans>;
  }

  return (
    <>
      {modelAndProvider(status)}
      {status.kind === "ready" ? null : (
        <>
          {" · "}
          <StateLabel status={status} />
        </>
      )}
    </>
  );
}

function modelAndProvider(status: { model: string; provider: string }) {
  return status.model === status.provider
    ? status.model
    : `${status.model} · ${status.provider}`;
}

function StateLabel({
  status,
}: {
  status: Exclude<ModelSetupStatus, { kind: "none" }>;
}) {
  switch (status.kind) {
    case "ready":
      return <Trans>ready</Trans>;
    case "installing": {
      const percent = formatDownloadProgress(status.progress);
      return percent ? (
        <Trans>installing {percent}</Trans>
      ) : (
        <Trans>starting download…</Trans>
      );
    }
    case "checking":
      return <>{status.message}</>;
    case "error":
      return <span className="text-danger">{status.message}</span>;
  }
}

function StatusDot({ status }: { status: ModelSetupStatus }) {
  return (
    <span
      aria-hidden
      className={cn([
        "size-2 shrink-0 rounded-full",
        status.kind === "ready" && "bg-foreground",
        (status.kind === "installing" || status.kind === "checking") &&
          "border-faint animate-status-pulse border-[1.5px]",
        status.kind === "error" && "bg-danger",
        status.kind === "none" && "border-faint border border-dashed",
      ])}
    />
  );
}
