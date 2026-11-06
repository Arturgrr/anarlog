import { useLingui } from "@lingui/react/macro";

import { Microphone, MicrophoneSlash } from "@anlg/ui/components/icons";
import { DropdownMenuItem } from "@anlg/ui/components/ui/dropdown-menu";

import { useListener } from "~/stt/contexts";
import { useStartListeningWithBatchOverride } from "~/stt/useStartListeningWithBatchOverride";
import {
  isMainWebviewWindow,
  requestMainListenerControl,
} from "~/stt/window-control";

export function Listening({
  sessionId,
  resume,
}: {
  sessionId: string;
  resume: boolean;
}) {
  const { t } = useLingui();
  const { mode, stop } = useListener((state) => ({
    mode: state.getSessionMode(sessionId),
    stop: state.stop,
  }));
  const isListening = mode === "active" || mode === "finalizing";
  const isFinalizing = mode === "finalizing";
  const isBatching = mode === "running_batch";
  const startListening = useStartListeningWithBatchOverride(sessionId);

  const handleToggleListening = () => {
    if (!isMainWebviewWindow()) {
      void requestMainListenerControl(
        isListening ? "stop" : "start",
        sessionId,
      );
      return;
    }

    if (isListening) {
      stop();
    } else {
      void startListening();
    }
  };

  const startLabel =
    resume || isBatching ? t`Resume listening` : t`Start listening`;

  return (
    <DropdownMenuItem
      className="cursor-pointer"
      onClick={handleToggleListening}
      disabled={isFinalizing}
    >
      {isListening ? <MicrophoneSlash /> : <Microphone />}
      <span>{isListening ? t`Stop listening` : startLabel}</span>
    </DropdownMenuItem>
  );
}
