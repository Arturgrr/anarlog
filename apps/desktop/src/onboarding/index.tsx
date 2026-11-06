import { Trans, useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { platform } from "@tauri-apps/plugin-os";
import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { commands as sfxCommands } from "@anlg/plugin-sfx";
import { SpeakerHigh, SpeakerX } from "@anlg/ui/components/icons";
import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";
import { cn } from "@anlg/utils";

import {
  getInitialStep,
  getNextStep,
  getPrevStep,
  getStepStatus,
  limitToMissingSelection,
  type OnboardingStep,
  saveOnboardingStep,
} from "./config";
import { FinalStep } from "./final";
import { WelcomeLanguagePicker } from "./language-picker";
import {
  IntelligenceStep,
  IntelligenceSummary,
  TranscriptionStep,
  TranscriptionSummary,
} from "./model-setup";
import { PermissionsSection } from "./permissions";
import { OnboardingSection } from "./shared";

import { NotificationProvider } from "~/contexts/notifications";
import { useSettingsReady } from "~/settings/queries";
import { useConfigValues } from "~/shared/config";
import { StandaloneWindowShell } from "~/shared/window-shell";
import { usePendingSttSelection } from "~/store/zustand/pending-stt-selection";
import { type Tab, useTabs } from "~/store/zustand/tabs";
import { isConfiguredSttModel } from "~/stt/capabilities";

export function TabContentOnboarding({
  tab: _tab,
}: {
  tab: Extract<Tab, { type: "onboarding" }>;
}) {
  const openCurrent = useTabs((state) => state.openCurrent);

  const handleFinish = useCallback(
    (sessionId: string) => {
      openCurrent({ type: "sessions", id: sessionId });
    },
    [openCurrent],
  );

  return <OnboardingScreen onFinish={handleFinish} />;
}

function OnboardingScreen({
  onFinish,
}: {
  onFinish: (sessionId: string) => void;
}) {
  return (
    <OnboardingScreenContent
      onFinish={onFinish}
      headerClassName="px-12 pt-4 pb-8"
      headerDragRegion
    />
  );
}

export function StandaloneOnboardingScreen({
  onFinish,
}: {
  onFinish: (sessionId: string) => void;
}) {
  // The main window's provider is not mounted yet, and model downloads started
  // here report their progress and select the model through this one.
  return (
    <StandaloneWindowShell>
      <NotificationProvider>
        <OnboardingScreenContent
          onFinish={onFinish}
          headerClassName="px-12 pt-4 pb-8"
          headerDragRegion
        />
      </NotificationProvider>
    </StandaloneWindowShell>
  );
}

function OnboardingScreenContent({
  onFinish,
  headerClassName,
  headerDragRegion = false,
}: {
  onFinish: (sessionId: string) => void;
  headerClassName: string;
  headerDragRegion?: boolean;
}) {
  const queryClient = useQueryClient();
  const { t } = useLingui();
  const [isMuted, setIsMuted] = useState(false);
  const [savedStep, setSavedStep] = useState(getInitialStep);
  const missingSelectionStep = useMissingSelectionStep();
  const currentStep = limitToMissingSelection(savedStep, missingSelectionStep);
  const onboardingVideoRef = useRef<HTMLVideoElement>(null);
  const currentPlatform = platform();

  const goTo = useCallback((step: OnboardingStep | null) => {
    if (!step) return;
    saveOnboardingStep(step);
    setSavedStep(step);
  }, []);

  const goNext = useCallback(
    () => goTo(getNextStep(currentStep)),
    [currentStep, goTo],
  );

  const goBack = useCallback(
    () => goTo(getPrevStep(currentStep)),
    [currentStep, goTo],
  );

  useMountEffect(() => {
    sfxCommands.play("BGM").catch(console.error);
    return () => {
      sfxCommands.stop("BGM").catch(console.error);
    };
  });

  useEffect(() => {
    sfxCommands.setVolume("BGM", isMuted ? 0 : 0.2).catch(console.error);
  }, [isMuted]);

  useMountEffect(() => {
    if (onboardingVideoRef.current) {
      onboardingVideoRef.current.playbackRate = 0.65;
    }
  });

  const handleFinish = useCallback(
    (sessionId: string) => {
      void queryClient.invalidateQueries({ queryKey: ["onboarding-needed"] });
      onFinish(sessionId);
    },
    [onFinish, queryClient],
  );

  return (
    <div className="bg-card relative flex h-full min-h-0 flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute inset-0"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 2, ease: [0.22, 1, 0.36, 1], delay: 0.4 }}
        >
          <video
            ref={onboardingVideoRef}
            className="absolute inset-0 h-full w-full object-cover object-bottom opacity-28 grayscale"
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            aria-hidden="true"
          >
            <source src="/assets/onboarding-video.mp4" type="video/mp4" />
          </video>
          <div className="from-background/8 via-background/18 absolute inset-0 bg-linear-to-t to-transparent" />
        </motion.div>
        <div className="absolute inset-x-0 top-0 h-[80%] [mask-image:linear-gradient(to_bottom,black,black_18%,rgba(0,0,0,0.9)_36%,rgba(0,0,0,0.6)_58%,transparent)] backdrop-blur-[32px]" />
        <div className="absolute inset-x-0 top-0 h-[92%] [mask-image:linear-gradient(to_bottom,black,rgba(0,0,0,0.8)_34%,rgba(0,0,0,0.35)_62%,transparent)] backdrop-blur-[12px]" />
        <div className="from-background via-background/82 via-background/97 to-background/0 absolute inset-x-0 top-0 h-[84%] bg-linear-to-b via-18% via-42%" />
        <motion.div
          className="bg-background absolute inset-0"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 1.0, ease: "easeOut", delay: 0.1 }}
        />
      </div>

      <div
        data-tauri-drag-region={headerDragRegion || undefined}
        className="relative z-30 flex h-12 shrink-0 items-center justify-end gap-1 pr-3 pl-12"
      >
        <WelcomeLanguagePicker />
        <button
          onClick={() => setIsMuted((prev) => !prev)}
          data-tauri-drag-region="false"
          className="hover:bg-hover active:bg-pressed rounded-md p-1.5"
          aria-label={isMuted ? t`Unmute` : t`Mute`}
        >
          {isMuted ? (
            <SpeakerX size={16} className="text-muted-foreground" />
          ) : (
            <SpeakerHigh size={16} className="text-muted-foreground" />
          )}
        </button>
      </div>

      <div
        data-tauri-drag-region={headerDragRegion || undefined}
        className={cn([
          "relative z-10 flex shrink-0 items-center",
          headerClassName,
        ])}
      >
        <h1 className="text-foreground font-sans text-4xl leading-none font-medium tracking-normal">
          <Trans>Welcome to Librelog</Trans>
        </h1>
      </div>

      <div className="scroll-fade-y relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-1 flex-col gap-4 px-12 pb-8">
          <OnboardingSection
            title={<Trans>Start with permissions</Trans>}
            completedTitle={<Trans>Permissions granted</Trans>}
            description={
              currentPlatform === "macos" ? (
                <Trans>
                  Librelog needs microphone and system audio to transcribe your
                  meetings, plus Accessibility to read meeting controls, visible
                  chat.
                </Trans>
              ) : (
                <Trans>
                  Librelog needs access to your microphone and system audio to
                  record and transcribe your meetings
                </Trans>
              )
            }
            status={getStepStatus("permissions", currentStep)}
            skippable={false}
            onBack={goBack}
            onNext={goNext}
          >
            <PermissionsSection onContinue={goNext} />
          </OnboardingSection>

          <OnboardingSection
            eyebrow={<Trans>1 of 2 · Transcription</Trans>}
            title={<Trans>How your meetings become text</Trans>}
            completedTitle={<TranscriptionSummary />}
            description={
              <Trans>
                Install a model on your Mac or connect a cloud provider. It’s
                the same list as Settings › Transcription.
              </Trans>
            }
            status={getStepStatus("transcription", currentStep)}
            fill
            skippable={false}
            onBack={goBack}
            onNext={goNext}
            onEdit={() => goTo("transcription")}
          >
            <TranscriptionStep onContinue={goNext} />
          </OnboardingSection>

          <OnboardingSection
            eyebrow={<Trans>2 of 2 · Intelligence</Trans>}
            title={<Trans>Who writes your summaries</Trans>}
            completedTitle={<IntelligenceSummary />}
            description={
              <Trans>
                Run a model on your Mac, sign in with a subscription or use an
                API key. It’s the same list as Settings › Intelligence.
              </Trans>
            }
            status={getStepStatus("intelligence", currentStep)}
            fill
            skippable={false}
            onBack={goBack}
            onNext={goNext}
            onEdit={() => goTo("intelligence")}
          >
            <IntelligenceStep onBack={goBack} onContinue={goNext} />
          </OnboardingSection>

          {currentStep === "final" ? (
            <FinalStep
              onBack={goBack}
              onChangeModel={() => goTo("transcription")}
              onFinish={handleFinish}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function useMissingSelectionStep(): OnboardingStep | null {
  const settingsReady = useSettingsReady();
  const pendingStt = usePendingSttSelection((state) => state.selection);
  const {
    current_stt_provider,
    current_stt_model,
    current_llm_provider,
    current_llm_model,
  } = useConfigValues([
    "current_stt_provider",
    "current_stt_model",
    "current_llm_provider",
    "current_llm_model",
  ] as const);

  if (!settingsReady) return null;
  if (
    !pendingStt &&
    !isConfiguredSttModel(current_stt_provider, current_stt_model)
  ) {
    return "transcription";
  }
  if (!current_llm_provider || !current_llm_model) return "intelligence";
  return null;
}
