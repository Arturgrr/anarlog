import type { ChatTransport, UIMessage } from "ai";

export type ChatTransportPreflight = {
  run: () => void | Promise<void>;
  persistOnCancel: boolean;
};

// Tauri `invoke` rejects with the serialized Rust error (a bare string), and
// the AI SDK stores whatever `sendMessages` throws as `useChat().error`
// without checking it is an Error. Normalize so the UI can rely on `.message`.
function toChatTransportError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === "string" ? error : String(error));
}

function abortError() {
  const error = new Error("Chat request aborted");
  error.name = "AbortError";
  return error;
}

export function withChatTransportPreflight<UI_MESSAGE extends UIMessage>(
  transport: ChatTransport<UI_MESSAGE>,
  takePreflight: (userMessageId: string) => ChatTransportPreflight | undefined,
): ChatTransport<UI_MESSAGE> {
  return {
    sendMessages: async (options) => {
      let userMessage: UI_MESSAGE | undefined;
      for (let i = options.messages.length - 1; i >= 0; i--) {
        if (options.messages[i].role === "user") {
          userMessage = options.messages[i];
          break;
        }
      }
      if (!userMessage) {
        throw new Error("Cannot send a chat request without a user message");
      }

      const preflight = takePreflight(userMessage.id);
      try {
        if (
          preflight &&
          (preflight.persistOnCancel || !options.abortSignal?.aborted)
        ) {
          await preflight.run();
        }
        if (options.abortSignal?.aborted) {
          throw abortError();
        }
        return await transport.sendMessages(options);
      } catch (error) {
        throw toChatTransportError(error);
      }
    },
    reconnectToStream: (options) => transport.reconnectToStream(options),
  };
}
