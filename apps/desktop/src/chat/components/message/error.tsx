import { Trans, useLingui } from "@lingui/react/macro";

import { commands as openerCommands } from "@anlg/plugin-opener2";
import {
  ArrowCounterClockwise,
  ArrowSquareOut,
} from "@anlg/ui/components/icons";

import { ActionButton, MessageBubble, MessageContainer } from "./shared";

import { docsUrl } from "~/shared/links";

// `useChat().error` is typed as Error but holds whatever the transport threw.
export function getChatErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : String(error);
}

function isContextLengthError(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  return (
    (lowerMessage.includes("n_keep") && lowerMessage.includes("n_ctx")) ||
    (lowerMessage.includes("context") && lowerMessage.includes("exceeds")) ||
    lowerMessage.includes("context length") ||
    lowerMessage.includes("context size")
  );
}

export function ErrorMessage({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const { t } = useLingui();
  const message = getChatErrorText(error);
  const showContextLengthHelp = isContextLengthError(message);

  const handleOpenFaq = () => {
    void openerCommands.openUrl(
      docsUrl("models-and-providers", "on-device-models"),
      null,
    );
  };

  return (
    <MessageContainer align="start">
      <MessageBubble variant="error" withActionButton={!!onRetry}>
        <p className="text-sm">{message}</p>
        {showContextLengthHelp && (
          <button
            onClick={handleOpenFaq}
            className="text-danger mt-2 flex items-center gap-1 text-xs underline hover:opacity-80"
          >
            <ArrowSquareOut className="h-3 w-3" />
            <Trans>Learn how to fix this</Trans>
          </button>
        )}
        {onRetry && (
          <ActionButton
            onClick={onRetry}
            variant="error"
            icon={ArrowCounterClockwise}
            label={t`Retry`}
          />
        )}
      </MessageBubble>
    </MessageContainer>
  );
}
