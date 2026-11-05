import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real iconify-icon web component renders asynchronously via timers that
// can fire after the test environment is torn down ("document is not
// defined" unhandled errors), so render an inert element instead.
vi.mock("@iconify-icon/react", () => ({
  Icon: (props: Record<string, unknown>) =>
    createElement("iconify-icon", props),
}));

const mocks = vi.hoisted(() => ({
  chatGroup: null as {
    id: string;
    ownerUserId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
  } | null,
  deleteChatAutomation: vi.fn(),
  deleteWorkflow: vi.fn(),
  removeDraft: vi.fn(),
  removeStarterDraft: vi.fn(),
  selection: null as unknown,
  setSettingValue: vi.fn<(...args: unknown[]) => Promise<void>>(() =>
    Promise.resolve(),
  ),
  settingValues: {} as Record<string, unknown>,
  workflows: [] as Array<{
    id: string;
    title: string;
    enabled: boolean;
    trigger: string;
    steps: unknown[];
    lastRun: null;
    processedSessionIds: string[];
    chatGroupId: string | null;
  }>,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("~/automations/actions", () => ({
  useRemoveStarterDraft: () => ({ mutate: mocks.removeStarterDraft }),
  useDeleteChatAutomation: () => ({ mutate: mocks.deleteChatAutomation }),
  useDeleteWorkflow: () => ({ mutate: mocks.deleteWorkflow }),
}));

vi.mock("~/automations/workflows", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/automations/workflows")>();
  return {
    ...actual,
    useAutomationWorkflows: () => mocks.workflows,
    saveAutomationWorkflows: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("~/automations/selection", () => ({
  useAutomationSelection: (selector: (state: unknown) => unknown) =>
    selector({ removeDraft: mocks.removeDraft }),
  useEffectiveAutomationSelection: () => mocks.selection,
}));

vi.mock("~/chat/store/queries", () => ({
  useChatGroup: () => mocks.chatGroup,
}));

vi.mock("~/settings/queries", () => ({
  setSettingValue: mocks.setSettingValue,
  setSettingValues: mocks.setSettingValue,
  getStoredSettingValues: () =>
    Promise.resolve({
      values: { automation_workflows: "[]" },
      hasValues: new Set(["automation_workflows"]),
    }),
  useStoredSettingValue: () => ({ value: "", hasValue: false }),
  useStoredSettingValues: () => ({
    values: mocks.settingValues,
    hasValues: new Set(),
  }),
}));

vi.mock("./starter-config", () => ({
  AutomationLastRunLine: () => null,
  MarkdownExportConfig: () => <div data-testid="config-markdown" />,
}));

vi.mock("@anlg/ui/components/ui/toast", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

import { AutomationsContent } from ".";

function renderAutomations() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AutomationsContent />
    </QueryClientProvider>,
  );
}

describe("AutomationsContent", () => {
  // Radix's focus scope schedules a focus dispatch on unmount, so drain the
  // timer queue while jsdom is still alive; left pending it fires against a
  // torn-down realm and vitest reports an unhandled error.
  afterEach(async () => {
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    mocks.chatGroup = null;
    mocks.deleteChatAutomation.mockClear();
    mocks.deleteWorkflow.mockClear();
    mocks.removeDraft.mockClear();
    mocks.removeStarterDraft.mockClear();
    mocks.selection = null;
    mocks.workflows = [];
    mocks.settingValues = {};
    mocks.setSettingValue.mockClear();
    mocks.toastError.mockClear();
    mocks.toastSuccess.mockClear();
  });

  it("shows the overview when nothing is selected", () => {
    renderAutomations();

    expect(screen.getByRole("heading", { name: "Automations" })).toBeTruthy();
    expect(screen.getByText("No automation draft yet")).toBeTruthy();
    expect(
      screen.getByText(
        "Choose a starter from the sidebar, or create a workflow and add steps like Zapier.",
      ),
    ).toBeTruthy();
  });

  it("shows the untitled draft page after the sidebar plus button", () => {
    mocks.selection = { kind: "draft", draftId: "draft-1" };

    renderAutomations();

    expect(
      screen.getByRole("heading", { name: "Untitled automation" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Add a trigger, then stack actions like Zapier."),
    ).toBeTruthy();
    expect(screen.getByText("Add an action")).toBeTruthy();
  });

  it("deletes a draft from its actions menu", async () => {
    mocks.selection = { kind: "draft", draftId: "draft-1" };

    renderAutomations();

    const trigger = screen.getByRole("button", { name: "Automation actions" });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);

    fireEvent.click(await screen.findByText("Delete automation"));

    expect(mocks.removeDraft).toHaveBeenCalledWith("draft-1");
  });

  it("shows the selected starter as an inspectable deterministic draft", () => {
    mocks.selection = { kind: "starter", starterId: "markdown-export" };

    renderAutomations();

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Test" }).disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save & enable",
      }).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByText("Expected output")).toBeTruthy();
  });

  it.each([
    {
      name: "draft",
      selection: { kind: "draft", draftId: "draft-1" },
      chatGroup: null,
      menuItem: "Delete automation",
      mock: mocks.removeDraft,
      id: "draft-1",
    },
    {
      name: "starter automation",
      selection: { kind: "starter", starterId: "markdown-export" },
      chatGroup: null,
      menuItem: "Remove automation",
      mock: mocks.removeStarterDraft,
      id: "markdown-export",
    },
    {
      name: "chat automation",
      selection: { kind: "chat", groupId: "automation-1" },
      chatGroup: {
        id: "automation-1",
        ownerUserId: "user-1",
        title: "Share weekly recap",
        createdAt: "2026-08-03T10:00:00.000Z",
        updatedAt: "2026-08-03T10:00:00.000Z",
      },
      menuItem: "Delete automation",
      mock: mocks.deleteChatAutomation,
      id: "automation-1",
    },
  ])(
    "deletes a $name from its actions menu",
    async ({ selection, chatGroup, menuItem, mock, id }) => {
      mocks.selection = selection;
      mocks.chatGroup = chatGroup;

      renderAutomations();

      const trigger = screen.getByRole("button", {
        name: "Automation actions",
      });
      fireEvent.pointerDown(trigger);
      fireEvent.click(trigger);

      fireEvent.click(await screen.findByText(menuItem));

      expect(mock).toHaveBeenCalledWith(id);
    },
  );

  it("saves the selected draft", async () => {
    mocks.selection = { kind: "starter", starterId: "markdown-export" };

    renderAutomations();

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(mocks.setSettingValue).toHaveBeenCalledWith(
        "automation_draft_template",
        "markdown-export",
      );
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Automation draft saved");
  });

  it("enables the Markdown export starter without a paid plan", async () => {
    mocks.selection = { kind: "starter", starterId: "markdown-export" };
    mocks.settingValues = {
      automation_markdown_export_directory: "/Users/me/Notes",
    };

    renderAutomations();

    fireEvent.click(screen.getByRole("button", { name: "Save & enable" }));

    await waitFor(() => {
      expect(mocks.setSettingValue).toHaveBeenCalledWith({
        automation_draft_template: "markdown-export",
        automation_markdown_export_enabled: true,
      });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Automation enabled");
  });
});
