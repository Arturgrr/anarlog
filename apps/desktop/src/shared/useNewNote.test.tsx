import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
}));

vi.mock("~/session/queries", () => ({
  createSession: mocks.createSession,
}));

import {
  openSessionAndListen,
  useNewNoteAndListen,
  useNewNoteDialog,
} from "./useNewNote";

import { resetSidebarNotes } from "~/sidebar/note-filter";
import { listenerStore } from "~/store/zustand/listener/instance";
import { useTabs } from "~/store/zustand/tabs";
import { resetTabsStore } from "~/store/zustand/tabs/test-utils";

beforeEach(() => {
  vi.clearAllMocks();
  resetTabsStore();
  resetSidebarNotes();
  listenerStore.setState(listenerStore.getInitialState(), true);
});

it("opens the live note instead of asking for a new one while recording", () => {
  const { result } = renderHook(() => useNewNoteAndListen());

  listenerStore.setState((state) => ({
    live: {
      ...state.live,
      status: "active",
      sessionId: "live-session",
    },
  }));
  act(() => result.current());

  expect(mocks.createSession).not.toHaveBeenCalled();
  expect(useTabs.getState().currentTab).toMatchObject({
    type: "sessions",
    id: "live-session",
  });
  expect(useNewNoteDialog.getState().request).toBeNull();
});

it("does not rearm auto-start when opening the active live session", () => {
  useTabs.getState().openNew({
    type: "sessions",
    id: "live-session",
    state: { view: null, autoStart: null },
  });
  listenerStore.setState((state) => ({
    live: {
      ...state.live,
      status: "active",
      sessionId: "live-session",
    },
  }));

  openSessionAndListen("live-session");

  expect(useTabs.getState().currentTab).toMatchObject({
    type: "sessions",
    id: "live-session",
    state: { autoStart: null },
  });
});

it("opens the requested session without auto-start while another is live", () => {
  listenerStore.setState((state) => ({
    live: {
      ...state.live,
      status: "active",
      sessionId: "live-session",
    },
  }));

  openSessionAndListen("other-session");

  expect(useTabs.getState().currentTab).toMatchObject({
    type: "sessions",
    id: "other-session",
    state: { autoStart: null },
  });
});
