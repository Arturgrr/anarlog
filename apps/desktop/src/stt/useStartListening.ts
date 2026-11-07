import { t } from "@lingui/core/macro";
import { useCallback } from "react";

import { toast } from "@anlg/ui/components/ui/toast";

import { useCaptureLifecycle } from "./capture-lifecycle";
import {
  clearCaptureAudioSaved,
  hasAudioAwaitingUser,
  hasPendingZeroRetentionAudio,
  loadCaptureLifecycleMarker,
} from "./capture-lifecycle-storage";
import { useListener } from "./contexts";
import { startMeetingChatCapture } from "./meeting-chat-capture";
import {
  MEETING_DISCLOSURE_MESSAGE,
  startMeetingRecordingDisclosure,
} from "./meeting-disclosure";
import { startMeetingScreenCapture } from "./meeting-screen-capture";
import {
  classifyStartFailure,
  getMicrophonePermission,
  showStartFailureToast,
  type StartFailureStage,
} from "./start-failure";

import { useShell } from "~/contexts/shell";
import { normalizeAudioRetention } from "~/services/audio-retention";
import { getBaseLanguageDisplayName } from "~/settings/general/language";
import { useConfigValue } from "~/shared/config";
import { useTabs } from "~/store/zustand/tabs";
import {
  getLiveTranscriptionConfig,
  getTranscriptionLanguages,
  requiresRetainedBatchAudio,
} from "~/stt/capabilities";
import {
  getSessionParticipantHumanIds,
  useSessionParticipantHumanIds,
} from "~/stt/queries";

export {
  getPostCaptureAction,
  getPostCaptureRepairReasons,
} from "./capture-lifecycle";
export { sendMeetingRecordingDisclosure } from "./meeting-disclosure";
export { useResumeListeningLifecycle } from "./resume-listening";

export function useStartListening(sessionId: string) {
  return useStartListeningState(sessionId).startListening;
}

export function useStartListeningState(
  sessionId: string,
  { automatic = false }: { automatic?: boolean } = {},
) {
  const {
    conn,
    connectionReady,
    createCaptureLifecycle,
    session,
    setStopMeetingChatCapture,
    stopMeetingChatTasks,
  } = useCaptureLifecycle(sessionId);
  const participantHumanIds = useSessionParticipantHumanIds(sessionId);
  const getSessionMode = useListener((state) => state.getSessionMode);
  const canStartLiveSession = useListener((state) => state.canStartLiveSession);
  const getLiveStartError = useListener((state) => state.getLiveStartError);

  const aiLanguage = useConfigValue("ai_language");
  const spokenLanguages = useConfigValue("spoken_languages");
  const dictionaryTerms = useConfigValue("personalization_dictionary_terms");
  const microphoneDevice = useConfigValue("microphone_device");
  const retainAudio =
    normalizeAudioRetention(useConfigValue("audio_retention")) !== "none" ||
    requiresRetainedBatchAudio(conn?.provider, conn?.model);
  const meetingDisclosureAutoSendChat = useConfigValue(
    "consent_auto_send_chat",
  );

  const start = useListener((state) => state.start);
  const stop = useListener((state) => state.stop);
  const { leftsidebar } = useShell();
  const setLeftSidebarExpanded = leftsidebar.setExpanded;
  const openNew = useTabs((state) => state.openNew);

  const reportStartFailure = useCallback(
    async (stage: StartFailureStage, error: string | null) => {
      const microphonePermission =
        stage === "recovery_marker" ? null : await getMicrophonePermission();
      showStartFailureToast(
        classifyStartFailure({ stage, error, microphonePermission }),
        (tab) => openNew({ type: "settings", state: { tab } }),
      );
    },
    [openNew],
  );

  const startListening = useCallback(async () => {
    if (!canStartLiveSession(sessionId)) {
      return;
    }
    await stopMeetingChatTasks();
    const previousMarker = await loadCaptureLifecycleMarker(sessionId).catch(
      (error) => {
        console.error("[listener] failed to load pending capture", error);
        return null;
      },
    );
    const pendingMarker =
      previousMarker &&
      (hasAudioAwaitingUser(previousMarker) ||
        hasPendingZeroRetentionAudio(previousMarker))
        ? previousMarker
        : undefined;
    const lifecycle = createCaptureLifecycle(
      undefined,
      automatic,
      pendingMarker,
    );
    const [keywords, liveTranscriptionConfig, remoteParticipantHumanIds] =
      await Promise.all([
        import("./useKeywords").then(({ getSessionKeywords }) =>
          getSessionKeywords({ sessionId, dictionaryTerms }),
        ),
        getLiveTranscriptionConfig({
          provider: conn?.provider,
          model: conn?.model,
          languages: getTranscriptionLanguages(aiLanguage, spokenLanguages),
        }),
        getSessionParticipantHumanIds(sessionId).catch((error) => {
          console.error(
            "[listener] failed to read session participants before capture",
            error,
          );
          return participantHumanIds;
        }),
        lifecycle.ready,
      ]);
    if (!canStartLiveSession(sessionId)) {
      return;
    }

    try {
      await lifecycle.persistMarker({
        postStopBatch: liveTranscriptionConfig.transcriptionMode === "batch",
      });
    } catch (error) {
      console.error(
        "[listener] failed to prepare durable capture state",
        error,
      );
      try {
        await lifecycle.cleanupFailedStart();
      } catch (cleanupError) {
        console.error(
          "[listener] failed to clean up capture state",
          cleanupError,
        );
      }
      await reportStartFailure("recovery_marker", null);
      return;
    }

    let started = false;
    try {
      started = await start(
        {
          session_id: sessionId,
          retain_audio: retainAudio,
          languages: liveTranscriptionConfig.languages,
          onboarding: false,
          model: conn?.model ?? "",
          base_url: conn?.baseUrl ?? "",
          api_key: conn?.apiKey ?? "",
          keywords,
          mic_device: microphoneDevice || null,
          transcription_mode: liveTranscriptionConfig.transcriptionMode,
          participant_human_ids: remoteParticipantHumanIds,
          self_human_id: session?.user_id || null,
          live_transcript: lifecycle.liveTranscript,
        },
        {
          handlePersist: lifecycle.handlePersist,
          onStopped: lifecycle.onStopped,
        },
      );
    } catch (error) {
      console.error("[listener] failed to start recording", error);
      try {
        await lifecycle.cleanupFailedStart();
      } catch (cleanupError) {
        console.error(
          "[listener] failed to clean up capture state",
          cleanupError,
        );
      }
      await reportStartFailure(
        "capture_start",
        error instanceof Error ? error.message : String(error),
      );
      return;
    }

    if (!started) {
      await stopMeetingChatTasks();
      try {
        await lifecycle.cleanupFailedStart();
      } catch (error) {
        console.error("[listener] failed to clean up capture state", error);
      }
      await reportStartFailure(
        "capture_rejected",
        getLiveStartError(sessionId),
      );
      return;
    }

    if (pendingMarker) {
      void clearCaptureAudioSaved(sessionId).catch((error) => {
        console.error("[listener] failed to clear capture audio state", error);
      });
    }

    const openTranscriptionSettings = () => {
      openNew({
        type: "settings",
        state: { tab: "transcription" },
      });
    };

    const primaryLanguage = liveTranscriptionConfig.languages[0];
    const omittedLanguages = liveTranscriptionConfig.omittedLanguages ?? [];
    if (conn && primaryLanguage && omittedLanguages.length > 0) {
      const primaryLanguageName = getBaseLanguageDisplayName(primaryLanguage);
      const omittedLanguageNames = omittedLanguages
        .map((language) => getBaseLanguageDisplayName(language))
        .join(", ");

      toast.warning(t`Live transcription is using ${primaryLanguageName}`, {
        id: "recording-with-limited-transcription-languages",
        duration: Infinity,
        description: t`Live transcription won't include ${omittedLanguageNames}. Audio is still being saved.`,
        action: {
          label: t`Change`,
          onClick: openTranscriptionSettings,
        },
      });
    } else if (!conn) {
      toast.warning(t`Live transcription is not configured`, {
        id: "recording-without-transcription",
        duration: Infinity,
        description: t`Audio is being saved. Choose a transcription provider to ensure this recording can be transcribed.`,
        action: {
          label: t`Configure`,
          onClick: openTranscriptionSettings,
        },
      });
    }

    setLeftSidebarExpanded(false);

    const stopChatCapture = startMeetingChatCapture({
      sessionId,
      excludedTexts: [MEETING_DISCLOSURE_MESSAGE],
      onParticipantDeclined: () => {
        toast.warning(
          t`A participant declined recording. Librelog stopped listening.`,
          { id: "meeting-consent-declined", duration: Infinity },
        );
        stop();
      },
    });
    const stopScreenCapture = startMeetingScreenCapture({ sessionId });
    setStopMeetingChatCapture(async () => {
      await Promise.all([stopChatCapture(), stopScreenCapture()]);
    });

    if (meetingDisclosureAutoSendChat) {
      startMeetingRecordingDisclosure(
        sessionId,
        () => getSessionMode(sessionId) === "active",
      );
    }
  }, [
    automatic,
    aiLanguage,
    canStartLiveSession,
    conn,
    createCaptureLifecycle,
    dictionaryTerms,
    getLiveStartError,
    getSessionMode,
    microphoneDevice,
    reportStartFailure,
    retainAudio,
    openNew,
    participantHumanIds,
    session,
    sessionId,
    setStopMeetingChatCapture,
    setLeftSidebarExpanded,
    meetingDisclosureAutoSendChat,
    spokenLanguages,
    start,
    stop,
    stopMeetingChatTasks,
  ]);

  return { connectionReady, startListening };
}
