import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  openTabListener: null as
    | ((event: { payload: { tab: unknown } }) => void)
    | null,
}));

vi.mock("@tanstack/react-router", () => ({
  Outlet: () => null,
  useNavigate: () => vi.fn(),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({}),
}));

vi.mock("@anlg/plugin-windows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@anlg/plugin-windows")>()),
  events: {
    navigate: () => ({ listen: () => Promise.resolve(() => {}) }),
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
  createSession: mocks.createSession,
}));

vi.mock("~/note-types/picker", () => ({
  NoteTypePicker: () => null,
}));

import MainAppLayout from "./main-app-layout";

import { listenerStore } from "~/store/zustand/listener/instance";
import { useTabs } from "~/store/zustand/tabs";
import { resetTabsStore } from "~/store/zustand/tabs/test-utils";

beforeEach(() => {
  vi.clearAllMocks();
  resetTabsStore();
  listenerStore.setState(listenerStore.getInitialState(), true);
  mocks.createSession.mockResolvedValue("tray-session");
});

afterEach(() => {
  cleanup();
});

it("starts recording the note created from the tray's Start meeting item", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MainAppLayout />
    </QueryClientProvider>,
  );

  await waitFor(() => expect(mocks.openTabListener).not.toBeNull());
  act(() =>
    mocks.openTabListener?.({
      payload: {
        tab: {
          type: "sessions",
          id: "new",
          state: { view: null, autoStart: true },
        },
      },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => {
    expect(useTabs.getState().currentTab).toMatchObject({
      type: "sessions",
      id: "tray-session",
      state: { autoStart: true },
    });
  });
});
