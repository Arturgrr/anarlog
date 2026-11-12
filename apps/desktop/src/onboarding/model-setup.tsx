import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { DownloadSimple } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { cn } from "@anlg/utils";

import {
  type ModelInstall,
  type ModelSetupStatus,
  useIntelligenceSetup,
  useTranscriptionSetup,
} from "./model-status";
import { OnboardingButton } from "./shared";

import { LlmModelPicker } from "~/settings/ai/llm";
import { startBuiltinDownload } from "~/settings/ai/llm/builtin-downloads";
import { builtinQueries } from "~/settings/ai/shared/list-builtin";
import { displayLlmModelId } from "~/settings/ai/shared/model-display";
import { SttModelPicker } from "~/settings/ai/stt";
import { DownloadProgressBar } from "~/settings/ai/stt/model-rows";
import {
  formatDownloadProgress,
  formatModelSize,
} from "~/settings/ai/stt/shared";
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
  // Running downloads keep going in the background, so neither holds up
  // this step.
  const canContinue =
    (status.kind === "ready" || status.kind === "installing") &&
    (transcription.kind === "ready" || transcription.kind === "installing");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {status.kind === "none" ? <BuiltinModelOffer /> : null}
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

// On a Mac that can run built-in models, offer the default one; nothing is
// downloaded until the person asks.
function BuiltinModelOffer() {
  const runtime = useQuery(builtinQueries.runtime());
  const models = useQuery({
    ...builtinQueries.models(),
    enabled: runtime.data?.available === true,
  });
  const download = useMutation({
    mutationFn: (model: Parameters<typeof startBuiltinDownload>[0]) =>
      startBuiltinDownload(model),
  });
  const entries = models.data ?? [];
  const offer =
    entries.find(
      (entry) => entry.default && entry.admission.fit !== "tooLarge",
    ) ?? entries.find((entry) => entry.best);

  if (!runtime.data?.available || !offer || offer.downloaded) {
    return null;
  }

  const name = displayLlmModelId(offer.id);
  const size = formatModelSize(offer.sizeBytes);

  return (
    <div className="bg-raised border-border-weak flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3 text-sm">
      <span className="min-w-0 flex-[1_1_16rem]">
        <span className="font-medium">
          <Trans>Run Intelligence on this Mac</Trans>
        </span>{" "}
        <span className="text-muted-foreground">
          <Trans>
            A built-in model writes summaries and titles without sending your
            meetings anywhere.
          </Trans>
        </span>
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={download.isPending}
        onClick={() => download.mutate(offer.id)}
      >
        <DownloadSimple className="size-3.5" aria-hidden />
        <Trans>
          Download {name} ({size})
        </Trans>
      </Button>
      {download.error ? (
        <span role="alert" className="text-danger w-full text-xs">
          {download.error.message}
        </span>
      ) : null}
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

export function ModelInstallList({
  installs,
  onChangeModel,
}: {
  installs: ModelInstall[];
  onChangeModel: () => void;
}) {
  const { t } = useLingui();
  const overall =
    installs.reduce((sum, install) => sum + installProgress(install), 0) /
    installs.length;

  return (
    <section
      aria-label={t`Model installation`}
      className="bg-raised border-border-weak flex w-full max-w-lg flex-col gap-4 rounded-xl border p-4"
    >
      {installs.map((install) => (
        <InstallRow key={install.id} install={install} />
      ))}
      {installs.length > 1 ? (
        <div className="border-border-weak flex flex-col gap-1.5 border-t pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium">
              <Trans>All models</Trans>
            </span>
            <span className="text-faint font-mono text-xs">
              {formatDownloadProgress(overall) ?? "0%"}
            </span>
          </div>
          <DownloadProgressBar
            label={t`Installing all models`}
            progress={overall}
          />
        </div>
      ) : null}
      <button
        type="button"
        onClick={onChangeModel}
        className="text-muted-foreground hover:text-foreground self-start text-xs underline-offset-2 hover:underline"
      >
        <Trans>Change model</Trans>
      </button>
    </section>
  );
}

function installProgress(install: ModelInstall) {
  return "progress" in install.state ? install.state.progress : 0;
}

function InstallRow({ install }: { install: ModelInstall }) {
  const { t } = useLingui();
  const { state } = install;
  const progress = installProgress(install);
  const percent = formatDownloadProgress(progress);
  const total = formatModelSize(install.sizeBytes);
  const downloaded =
    percent && install.sizeBytes
      ? formatModelSize((install.sizeBytes * progress) / 100)
      : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{install.name}</span>
        <span className="text-faint text-xs">{install.provider}</span>
        <span className="flex-1" />
        <span
          className={cn([
            "text-xs",
            state.kind === "error" ? "text-danger" : "text-muted-foreground",
          ])}
        >
          <InstallStateLabel state={state} />
        </span>
      </div>
      <DownloadProgressBar
        label={t`Installing ${install.name}`}
        progress={progress}
      />
      {percent || total ? (
        <span className="text-faint font-mono text-xs">
          {[percent, downloaded && total ? `${downloaded} / ${total}` : total]
            .filter(Boolean)
            .join(" · ")}
        </span>
      ) : null}
      {state.kind === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-2">
          <span className="text-danger min-w-0 flex-1 text-xs break-words">
            {state.message}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={install.start}
          >
            <Trans>Try again</Trans>
          </Button>
        </div>
      ) : null}
      {state.kind === "interrupted" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground min-w-0 flex-1 text-xs">
            <Trans>The download stopped before it finished.</Trans>
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={install.start}
          >
            <Trans>Resume download</Trans>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function InstallStateLabel({ state }: { state: ModelInstall["state"] }) {
  switch (state.kind) {
    case "checking":
      return <Trans>Checking…</Trans>;
    case "queued":
      return <Trans>Queued</Trans>;
    case "downloading":
      return <Trans>Downloading</Trans>;
    case "preparing":
      return <Trans>Preparing…</Trans>;
    case "error":
      return <Trans>Couldn’t install</Trans>;
    case "interrupted":
      return <Trans>Download stopped</Trans>;
  }
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
  if (status.kind === "ready" || status.kind === "installing") {
    return null;
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
