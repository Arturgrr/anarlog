import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  takePendingTrayStart: vi.fn(),
  folderError: null as unknown,
  windowLabel: "main",
  navigateListener: null as
    | ((event: {
        payload: { path: string; search: Record<string, string> | null };
      }) => void)
    | null,
  openTabListener: null as
    | ((event: { payload: { tab: unknown } }) => void)
    | null,
}));

vi.mock("@tanstack/react-router", () => ({
  Outlet: () => null,
  useNavigate: () => vi.fn(),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: mocks.windowLabel }),
}));

vi.mock("@anlg/plugin-tray", () => ({
  commands: { takePendingTrayStart: mocks.takePendingTrayStart },
}));

vi.mock("@anlg/plugin-windows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@anlg/plugin-windows")>()),
  events: {
    navigate: () => ({
      listen: (listener: typeof mocks.navigateListener) => {
        mocks.navigateListener = listener;
        return Promise.resolve(() => {});
      },
    }),
    openTab: () => ({
      listen: (listener: typeof mocks.openTabListener) => {
        mocks.openTabListener = listener;
        return Promise.resolve(() => {});
      },
    }),
  },
}));

vi.mock("~/sidebar/toast/undo-delete-toast", () => ({
  UndoDeleteToast: () => null,
}));

vi.mock("~/shared/zoom", () => ({
  useZoomShortcuts: () => {},
}));

vi.mock("~/session/queries", () => ({
  createSessionReportingFolder: async (...args: unknown[]) => ({
    sessionId: await mocks.createSession(...args),
    folderError: mocks.folderError,
  }),
}));

vi.mock("~/note-types/picker", () => ({
  NoteTypePicker: () => null,
}));

import MainAppLayout from "./main-app-layout";
import { useNewNoteDialog } from "./useNewNote";

import { listenerStore } from "~/store/zustand/listener/instance";
import { useTabs } from "~/store/zustand/tabs";
import { resetTabsStore } from "~/store/zustand/tabs/test-utils";

const trayStartTab = {
  type: "sessions",
  id: "new",
  state: { view: null, autoStart: true },
};

function renderLayout() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MainAppLayout />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.folderError = null;
  mocks.windowLabel = "main";
  mocks.navigateListener = null;
  mocks.openTabListener = null;
  useNewNoteDialog.setState({ request: null });
  resetTabsStore();
  listenerStore.setState(listenerStore.getInitialState(), true);
  mocks.createSession.mockResolvedValue("tray-session");
  mocks.takePendingTrayStart.mockResolvedValue({ status: "ok", data: false });
});

afterEach(() => {
  cleanup();
});

it("records the tray's Start meeting in one untitled note without a dialog", async () => {
  renderLayout();
  await waitFor(() => expect(mocks.takePendingTrayStart).toHaveBeenCalled());

  mocks.takePendingTrayStart.mockResolvedValue({ status: "ok", data: true });
  act(() => mocks.openTabListener?.({ payload: { tab: trayStartTab } }));

  await waitFor(() => {
    expect(useTabs.getState().currentTab).toMatchObject({
      type: "sessions",
      id: "tray-session",
      state: { autoStart: true },
    });
  });
  expect(mocks.createSession).toHaveBeenCalledTimes(1);
  expect(mocks.createSession).toHaveBeenCalledWith("");
  expect(useNewNoteDialog.getState().request).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("records a tray Start meeting sent before the main window was listening", async () => {
  mocks.takePendingTrayStart.mockResolvedValue({ status: "ok", data: true });
  renderLayout();

  await waitFor(() => {
    expect(useTabs.getState().currentTab).toMatchObject({
      id: "tray-session",
      state: { autoStart: true },
    });
  });
  expect(useNewNoteDialog.getState().request).toBeNull();
});

it.each([
  [null, false],
  [{ record: "true" }, true],
])(
  "still asks for the name when /app/new opens a note (search %o)",
  async (search, record) => {
    renderLayout();
    await waitFor(() => expect(mocks.navigateListener).not.toBeNull());

    act(() =>
      mocks.navigateListener?.({ payload: { path: "/app/new", search } }),
    );

    expect(useNewNoteDialog.getState().request).toMatchObject({ record });
    expect(await screen.findByRole("dialog")).not.toBeNull();
    expect(mocks.createSession).not.toHaveBeenCalled();
  },
);

it("leaves the tray's Start meeting to the main window", async () => {
  mocks.windowLabel = "note-session-1";
  mocks.takePendingTrayStart.mockResolvedValue({ status: "ok", data: true });
  renderLayout();

  await waitFor(() => expect(mocks.openTabListener).not.toBeNull());
  act(() => mocks.openTabListener?.({ payload: { tab: trayStartTab } }));
  await act(async () => {});

  expect(mocks.takePendingTrayStart).not.toHaveBeenCalled();
  expect(mocks.createSession).not.toHaveBeenCalled();
  expect(useNewNoteDialog.getState().request).toBeNull();
});
