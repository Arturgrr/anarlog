import { cleanup, render, waitFor } from "@testing-library/react";
import type { UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatSessionHost } from "./chat-panel";
import { ChatSession, type ChatSessionRenderProps } from "./session-provider";

import { useChatContext } from "~/chat/state/chat-context";
import type { PersistedChatMessage } from "~/chat/store/persisted-messages";
import type { AnlgUIMessage } from "~/chat/types";
import { MainShellScaffold } from "~/shared/main/shell-scaffold";

const mocks = vi.hoisted(() => ({
  currentTab: { type: "sessions" } as { type: string },
  createChatGroupWithMessage: vi.fn().mockResolvedValue(undefined),
  deleteChatMessage: vi.fn().mockResolvedValue(undefined),
  deleteChatMessagesExcept: vi.fn().mockResolvedValue(undefined),
  flushDatabaseWritesByPrefix: vi.fn().mockResolvedValue(undefined),
  getChatMessageGroupId: vi.fn().mockResolvedValue(null),
  ids: [] as string[],
  persistedMessages: [] as PersistedChatMessage[],
  replaceChatMessage: vi.fn().mockResolvedValue(undefined),
  sendMessages: vi.fn(),
  setChatGroupTitleIfCurrent: vi.fn().mockResolvedValue(undefined),
  transport: {} as {
    sendMessages: ReturnType<typeof vi.fn>;
    reconnectToStream: ReturnType<typeof vi.fn>;
  },
  transportIdentityChangesEveryRender: false,
  upsertChatMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/store/zustand/tabs", () => ({
  useTabs: (
    selector: (state: { currentTab: typeof mocks.currentTab }) => unknown,
  ) => selector({ currentTab: mocks.currentTab }),
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => "macos",
}));

vi.mock("~/contexts/shell", () => ({
  useShell: () => ({
    chat: {
      scope:
        mocks.currentTab.type === "automations" ? "automations" : "general",
      ...useChatContext.getState().chatByScope[
        mocks.currentTab.type === "automations" ? "automations" : "general"
      ],
    },
  }),
}));

vi.mock("./use-session-tab", () => ({
  useSessionTab: () => ({ currentSessionId: "note-1" }),
}));

vi.mock("~/session/queries", () => ({
  useSessionHasTranscript: () => true,
}));

vi.mock("~/stt/contexts", () => ({
  useListener: (selector: (state: unknown) => unknown) =>
    selector({
      getSessionMode: () => "active",
      live: {
        requestedLiveTranscription: true,
        liveTranscriptionActive: true,
        batchTranscriptionPendingBySession: {},
      },
    }),
}));

vi.mock("./body", () => ({ ChatBody: () => null }));
vi.mock("./content", () => ({ ChatContent: () => null }));
vi.mock("./toolbar-controls", () => ({ ChatToolbarControls: () => null }));

vi.mock("~/ai/hooks", () => ({
  useLanguageModel: () => undefined,
}));

vi.mock("@anlg/ui/components/ui/toast", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("~/chat/context/use-chat-context-pipeline", () => ({
  useChatContextPipeline: () => ({
    contextEntities: [],
    pendingRefs: [],
  }),
}));

vi.mock("~/chat/store/queries", () => ({
  createChatGroupWithMessage: mocks.createChatGroupWithMessage,
  deleteChatMessage: mocks.deleteChatMessage,
  deleteChatMessagesExcept: mocks.deleteChatMessagesExcept,
  getChatMessageGroupId: mocks.getChatMessageGroupId,
  replaceChatMessage: mocks.replaceChatMessage,
  setChatGroupTitleIfCurrent: mocks.setChatGroupTitleIfCurrent,
  upsertChatMessage: mocks.upsertChatMessage,
  usePersistedChatMessages: () => mocks.persistedMessages,
}));

vi.mock("~/chat/transport/use-transport", () => ({
  useTransport: () => ({
    transport: mocks.transportIdentityChangesEveryRender
      ? { ...mocks.transport }
      : mocks.transport,
    isSystemPromptReady: true,
  }),
}));

vi.mock("~/db/write-queue", () => ({
  flushDatabaseWritesByPrefix: mocks.flushDatabaseWritesByPrefix,
}));

vi.mock("~/shared/owner-user", () => ({
  useLocalUserId: () => "owner-1",
}));

vi.mock("~/shared/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/shared/utils")>()),
  id: () => mocks.ids.shift(),
}));

const userMessage: AnlgUIMessage = {
  id: "user-1",
  role: "user",
  parts: [{ type: "text", text: "Question" }],
};

function renderHarness(inMainShell = false) {
  let current: ChatSessionRenderProps | undefined;
  const content = (
    <ChatSession chatGroupId="group-1" sessionId="session-1" unstyled>
      {(props) => {
        current = props;
        return null;
      }}
    </ChatSession>
  );
  const renderContent = () =>
    inMainShell ? (
      <MainShellScaffold>
        <ChatSessionHost>
          {(props) => {
            current = props ?? undefined;
            return null;
          }}
        </ChatSessionHost>
      </MainShellScaffold>
    ) : (
      content
    );
  const view = render(renderContent());
  return {
    rerender: () => view.rerender(renderContent()),
    get props() {
      if (!current) {
        throw new Error("ChatSession did not render");
      }
      return current;
    },
    view,
  };
}

describe("ChatSession real SDK", () => {
  beforeEach(() => {
    mocks.currentTab = { type: "sessions" };
    useChatContext.setState({
      chatByScope: {
        general: { groupId: "group-1", sessionId: "session-1" },
        automations: { groupId: "group-2", sessionId: "session-2" },
      },
    });
    vi.clearAllMocks();
    mocks.createChatGroupWithMessage.mockReset().mockResolvedValue(undefined);
    mocks.deleteChatMessage.mockReset().mockResolvedValue(undefined);
    mocks.deleteChatMessagesExcept.mockReset().mockResolvedValue(undefined);
    mocks.flushDatabaseWritesByPrefix.mockReset().mockResolvedValue(undefined);
    mocks.getChatMessageGroupId.mockReset().mockResolvedValue(null);
    mocks.ids = ["user-new", "group-new"];
    mocks.replaceChatMessage.mockReset().mockResolvedValue(undefined);
    mocks.setChatGroupTitleIfCurrent.mockReset().mockResolvedValue(undefined);
    mocks.upsertChatMessage.mockReset().mockResolvedValue(undefined);
    mocks.sendMessages = vi.fn().mockResolvedValue(
      new ReadableStream({
        start: (controller) => controller.close(),
      }),
    );
    mocks.transport = {
      sendMessages: mocks.sendMessages,
      reconnectToStream: vi.fn().mockResolvedValue(null),
    };
    mocks.transportIdentityChangesEveryRender = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps the in-flight response visible when upstream hooks hand over a new transport object", async () => {
    // Model/provider hooks can return fresh objects on every render; the chat
    // instance must survive that or the UI silently detaches from the stream.
    mocks.transportIdentityChangesEveryRender = true;
    let controller!: ReadableStreamDefaultController<UIMessageChunk>;
    mocks.sendMessages.mockResolvedValue(
      new ReadableStream<UIMessageChunk>({
        start: (streamController) => {
          controller = streamController;
        },
      }),
    );
    const harness = renderHarness();

    harness.props.sendMessage(userMessage, {
      chatGroupId: "group-1",
      beforeSend: vi.fn().mockResolvedValue(undefined),
    });

    await waitFor(() => expect(harness.props.status).toBe("submitted"));
    expect(harness.props.messages.map((message) => message.id)).toEqual([
      userMessage.id,
    ]);

    await waitFor(() => expect(mocks.sendMessages).toHaveBeenCalledOnce());
    controller.enqueue({ type: "start", messageId: "assistant-1" });
    controller.enqueue({ type: "text-start", id: "text-1" });
    controller.enqueue({ type: "text-delta", id: "text-1", delta: "Hello" });

    await waitFor(() => {
      expect(harness.props.status).toBe("streaming");
      const { messages } = harness.props;
      expect(messages[messages.length - 1]).toMatchObject({
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Hello" }],
      });
    });

    controller.enqueue({ type: "text-end", id: "text-1" });
    controller.enqueue({ type: "finish" });
    controller.close();

    await waitFor(() => expect(harness.props.status).toBe("ready"));
    expect(harness.props.messages.map((message) => message.id)).toEqual([
      userMessage.id,
      "assistant-1",
    ]);
  });

  it("finishes and saves a streaming reply across screen and scope changes with live-recording context", async () => {
    let controller!: ReadableStreamDefaultController<UIMessageChunk>;
    mocks.sendMessages.mockResolvedValue(
      new ReadableStream<UIMessageChunk>({
        start: (streamController) => {
          controller = streamController;
        },
      }),
    );
    const harness = renderHarness(true);
    harness.props.sendMessage(userMessage, { chatGroupId: "group-1" });
    await waitFor(() => expect(harness.props.status).toBe("submitted"));
    controller.enqueue({ type: "start", messageId: "assistant-1" });
    controller.enqueue({ type: "text-start", id: "text-1" });
    controller.enqueue({ type: "text-delta", id: "text-1", delta: "Hello" });
    await waitFor(() => expect(harness.props.status).toBe("streaming"));

    for (const type of [
      "settings",
      "contacts",
      "humans",
      "folders",
      "templates",
      "changelog",
      "edit",
      "onboarding",
      "empty",
    ]) {
      mocks.currentTab = { type };
      harness.rerender();
      expect(harness.props.status, type).toBe("streaming");
    }
    mocks.currentTab = { type: "automations" };
    harness.rerender();
    expect(harness.props.sessionId).toBe("session-2");
    expect(harness.props.messages).toEqual([]);

    mocks.currentTab = { type: "sessions" };
    harness.rerender();
    expect(harness.props.sessionId).toBe("session-1");
    expect(harness.props.status).toBe("streaming");
    controller.enqueue({ type: "text-delta", id: "text-1", delta: " world" });
    await waitFor(() =>
      expect(
        harness.props.messages[harness.props.messages.length - 1]?.parts,
      ).toEqual([{ type: "text", text: "Hello world", state: "streaming" }]),
    );

    mocks.currentTab = { type: "sessions" };
    harness.rerender();
    expect(harness.props.status).toBe("streaming");
    mocks.currentTab = { type: "automations" };
    harness.rerender();
    controller.enqueue({ type: "text-end", id: "text-1" });
    controller.enqueue({ type: "finish" });
    controller.close();
    await waitFor(() =>
      expect(mocks.upsertChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "assistant-1",
          chatGroupId: "group-1",
          content: expect.stringContaining("Hello world"),
        }),
      ),
    );
    mocks.currentTab = { type: "sessions" };
    harness.rerender();
    expect(harness.props.status).toBe("ready");
  });
});
