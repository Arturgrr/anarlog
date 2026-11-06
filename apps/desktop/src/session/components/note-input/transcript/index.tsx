import { Trans } from "@lingui/react/macro";
import type { RefObject } from "react";
import { useCallback } from "react";

import { useRegenerateTranscript } from "./actions";
import { TranscriptViewer } from "./renderer";
import { BatchState } from "./screens/batch";
import { TranscriptEmptyState } from "./screens/empty";
import { LiveTranscriptInterruptedNotice } from "./screens/interrupted";
import { TranscriptListeningState } from "./screens/listening";
import { useTranscriptScreen } from "./state";

import { localizeExternalMessage } from "~/i18n/external-messages";
import { useIncompleteCapture } from "~/stt/capture-result";
import { useListener } from "~/stt/contexts";
import { useUploadFile } from "~/stt/useUploadFile";

export function Transcript({
  sessionId,
  scrollRef,
  editMode = false,
  onEditModeChange,
}: {
  sessionId: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  editMode?: boolean;
  onEditModeChange?: (editMode: boolean) => void;
}) {
  return (
    <TranscriptContent
      key={sessionId}
      sessionId={sessionId}
      scrollRef={scrollRef}
      editMode={editMode}
      onEditModeChange={onEditModeChange}
    />
  );
}

function TranscriptContent({
  sessionId,
  scrollRef,
  editMode,
  onEditModeChange,
}: {
  sessionId: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  editMode: boolean;
  onEditModeChange?: (editMode: boolean) => void;
}) {
  const screen = useTranscriptScreen({ sessionId });
  const incompleteCapture = useIncompleteCapture(sessionId);
  const { uploadAudio, uploadTranscript } = useUploadFile(sessionId);
  const regenerateTranscript = useRegenerateTranscript(sessionId);
  const stopTranscription = useListener((state) => state.stopTranscription);
  const handleStopTranscription = useCallback(() => {
    void stopTranscription(sessionId);
  }, [sessionId, stopTranscription]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {incompleteCapture && (
        <div
          role="status"
          className="border-border bg-layer-2 text-foreground border-b px-4 py-2 text-sm"
        >
          <span className="font-medium">
            {incompleteCapture.audioDeletionFailed ? (
              <Trans>Audio could not be deleted.</Trans>
            ) : (
              <Trans>This transcript is incomplete.</Trans>
            )}
          </span>{" "}
          {incompleteCapture.audioDeletionFailed ? (
            <Trans>
              Librelog could not remove the temporary audio. Cleanup will be
              retried automatically.
            </Trans>
          ) : incompleteCapture.audioKeptForTranscription ? (
            <Trans>
              Some audio has not been transcribed yet, so Librelog kept it
              temporarily. It will be deleted automatically once transcription
              succeeds.
            </Trans>
          ) : incompleteCapture.audioDeleted ? (
            <Trans>
              Recovery did not finish before the meeting ended. Audio was
              deleted according to your retention setting.
            </Trans>
          ) : (
            <Trans>
              Some audio could not be transcribed. Available recordings were
              kept according to your retention setting.
            </Trans>
          )}
        </div>
      )}
      {screen.kind === "running_batch" && (
        <TranscriptEmptyState
          isBatching
          percentage={screen.percentage}
          phase={screen.phase}
          onStopTranscription={
            screen.phase === "importing" ? undefined : handleStopTranscription
          }
        />
      )}
      {screen.kind === "batch_fallback" && (
        <BatchState
          requestedLiveTranscription={screen.requestedLiveTranscription}
        />
      )}
      {screen.kind === "listening" && (
        <TranscriptListeningState status={screen.status} />
      )}
      {screen.kind === "empty" && (
        <TranscriptEmptyState
          isBatching={false}
          hasAudio={screen.hasAudio}
          error={
            screen.error ? localizeExternalMessage(screen.error) : screen.error
          }
          onRetranscribe={regenerateTranscript}
          onUploadAudio={uploadAudio}
          onUploadTranscript={uploadTranscript}
        />
      )}
      {screen.kind === "ready" && (
        <TranscriptViewer
          transcriptIds={screen.transcriptIds}
          liveSegments={screen.liveSegments}
          currentActive={screen.currentActive}
          captureGeneration={screen.captureGeneration}
          scrollRef={scrollRef}
          editMode={editMode && !screen.currentActive}
          onEditModeChange={screen.currentActive ? undefined : onEditModeChange}
          footer={
            screen.liveTranscriptInterrupted ? (
              <LiveTranscriptInterruptedNotice />
            ) : null
          }
        />
      )}
    </div>
  );
}
