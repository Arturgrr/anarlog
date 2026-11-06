import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";

import { commands as openerCommands } from "@anlg/plugin-opener2";
import { commands as sfxCommands } from "@anlg/plugin-sfx";
import { CircleNotch, GithubLogo } from "@anlg/ui/components/icons";
import { cn } from "@anlg/utils";

import { saveOnboardingStep } from "./config";
import { ModelInstallList } from "./model-setup";
import { useModelInstalls } from "./model-status";
import { OnboardingButton, OnboardingSection } from "./shared";
import {
  getOrCreateWelcomeSession,
  setPendingWelcomeSession,
} from "./welcome-note";

import { createSession } from "~/session/queries";
import { SttSettingsProvider } from "~/settings/ai/stt/context";
import { REPOSITORY_URL } from "~/shared/links";
import { flushAutomaticRelaunch } from "~/shared/relaunch";
import { commands } from "~/types/tauri.gen";

export function FinalDescription() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span>
        <Trans>Join our community and stay updated:</Trans>
      </span>
      <button
        onClick={() => void openerCommands.openUrl(REPOSITORY_URL, null)}
        className="text-muted-foreground hover:text-muted-foreground inline-flex size-5 items-center justify-center rounded-md transition-colors duration-150"
        aria-label="GitHub"
      >
        <GithubLogo size={18} />
      </button>
    </div>
  );
}

export function FinalStep({
  onBack,
  onChangeModel,
  onFinish,
}: {
  onBack: () => void;
  onChangeModel: () => void;
  onFinish: (sessionId: string) => void;
}) {
  return (
    <SttSettingsProvider selectOnDownload>
      <FinalStepContent
        onBack={onBack}
        onChangeModel={onChangeModel}
        onFinish={onFinish}
      />
    </SttSettingsProvider>
  );
}

function FinalStepContent({
  onBack,
  onChangeModel,
  onFinish,
}: {
  onBack: () => void;
  onChangeModel: () => void;
  onFinish: (sessionId: string) => void;
}) {
  const installs = useModelInstalls();
  const installing = installs.length > 0;

  return (
    <OnboardingSection
      title={
        installing ? <Trans>Almost ready</Trans> : <Trans>Ready to go</Trans>
      }
      description={<FinalDescription />}
      status="active"
      skippable={false}
      onBack={onBack}
      onNext={installing ? undefined : () => void finishOnboarding(onFinish)}
    >
      <div className="flex flex-col items-start gap-5">
        {installing ? (
          <ModelInstallList installs={installs} onChangeModel={onChangeModel} />
        ) : null}
        <FinalSection onContinue={onFinish} waitingForInstall={installing} />
      </div>
    </OnboardingSection>
  );
}

export function FinalSection({
  onContinue,
  waitingForInstall = false,
}: {
  onContinue: (sessionId: string) => void;
  waitingForInstall?: boolean;
}) {
  const { t } = useLingui();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const finishPromiseRef = useRef<Promise<void> | null>(null);
  const welcomeSessionRef = useRef<string | null>(null);

  const handleContinue = async () => {
    if (finishPromiseRef.current) return;

    setStatus("loading");
    const finishPromise = finishOnboarding(onContinue, welcomeSessionRef);
    finishPromiseRef.current = finishPromise;
    try {
      await finishPromise;
    } catch (error) {
      console.error("Failed to finish onboarding", error);
      setStatus("error");
    } finally {
      finishPromiseRef.current = null;
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <OnboardingButton
        className={cn([
          "px-6 py-2 text-sm disabled:opacity-70",
          status === "loading" && "disabled:cursor-wait",
        ])}
        disabled={status === "loading" || waitingForInstall}
        onClick={() => void handleContinue()}
      >
        {status === "loading" ? (
          <span className="flex items-center gap-2">
            <CircleNotch className="size-4 animate-spin" />
            <Trans>Open Librelog</Trans>
          </span>
        ) : (
          <Trans>Open Librelog</Trans>
        )}
      </OnboardingButton>
      {waitingForInstall ? (
        <p className="text-muted-foreground text-xs">
          <Trans>Opens when the models finish installing</Trans>
        </p>
      ) : null}
      {status === "error" && (
        <p className="text-danger text-sm" role="alert">
          {t`Couldn't open Librelog. Please try again.`}
        </p>
      )}
    </div>
  );
}

export async function finishOnboarding(
  onContinue?: (sessionId: string) => void,
  welcomeSessionRef?: { current: string | null },
) {
  await sfxCommands.stop("BGM").catch(console.error);
  const welcomeSessionId =
    welcomeSessionRef?.current ??
    (await getOrCreateWelcomeSession().catch((error) => {
      console.error("Failed to create welcome note", error);
      return createSession();
    }));
  if (welcomeSessionRef) {
    welcomeSessionRef.current = welcomeSessionId;
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  const result = await commands.setOnboardingNeeded(false);
  if (result.status === "error") {
    throw new Error(result.error);
  }
  saveOnboardingStep(null);
  await new Promise((resolve) => setTimeout(resolve, 100));
  setPendingWelcomeSession(welcomeSessionId);
  if (await flushAutomaticRelaunch()) {
    return;
  }
  setPendingWelcomeSession(null);
  onContinue?.(welcomeSessionId);
}
