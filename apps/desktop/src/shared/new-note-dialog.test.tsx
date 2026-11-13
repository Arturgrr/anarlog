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
  setSessionNoteType: vi.fn(),
}));

vi.mock("~/session/queries", () => ({
  createSession: mocks.createSession,
}));

vi.mock("~/note-types/queries", () => ({
  setSessionNoteType: mocks.setSessionNoteType,
}));

vi.mock("~/note-types/picker", () => ({
  NoteTypePicker: ({
    onChange,
  }: {
    onChange: (next: { typeId: string; subtypeId: string }) => void;
  }) => (
    <button
      type="button"
      onClick={() => onChange({ typeId: "interview", subtypeId: "screen" })}
    >
      Pick type
    </button>
  ),
}));

import { NewNoteDialog } from "./new-note-dialog";
import { openNewNote, openNewNoteAndListen } from "./useNewNote";

import { resetSidebarNotes, useSidebarNotes } from "~/sidebar/note-filter";
import { listenerStore } from "~/store/zustand/listener/instance";
import { useTabs } from "~/store/zustand/tabs";
import { resetTabsStore } from "~/store/zustand/tabs/test-utils";

function renderDialog() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NewNoteDialog />
    </QueryClientProvider>,
  );
}

function nameField() {
  return screen.getByPlaceholderText("Untitled");
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTabsStore();
  resetSidebarNotes();
  listenerStore.setState(listenerStore.getInitialState(), true);
  mocks.createSession.mockResolvedValue("new-session");
  mocks.setSessionNoteType.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

it("creates the named, typed note in the active folder and opens it", async () => {
  useSidebarNotes.getState().setView("mine", "CS 101");
  renderDialog();
  act(() => openNewNote());

  expect(document.activeElement).toBe(nameField());
  fireEvent.change(nameField(), { target: { value: "  Customer call " } });
  fireEvent.click(screen.getByRole("button", { name: "Pick type" }));
  fireEvent.submit(nameField().closest("form")!);

  await waitFor(() => {
    expect(useTabs.getState().currentTab).toMatchObject({
      type: "sessions",
      id: "new-session",
    });
  });
  expect(mocks.createSession).toHaveBeenCalledWith("Customer call", undefined, {
    folder_id: "CS 101",
  });
  expect(mocks.setSessionNoteType).toHaveBeenCalledWith("new-session", {
    typeId: "interview",
    subtypeId: "screen",
  });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("starts recording the new note when confirmed in record mode", async () => {
  renderDialog();
  act(() => openNewNoteAndListen());

  fireEvent.change(nameField(), { target: { value: "Standup" } });
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));

  await waitFor(() => {
    expect(useTabs.getState().currentTab).toMatchObject({
      type: "sessions",
      id: "new-session",
      state: { autoStart: true },
    });
  });
  expect(mocks.createSession).toHaveBeenCalledWith("Standup");
});

it("creates an untitled note when confirmed with an empty name", async () => {
  renderDialog();
  act(() => openNewNote());

  fireEvent.submit(nameField().closest("form")!);

  await waitFor(() => {
    expect(useTabs.getState().currentTab).toMatchObject({
      id: "new-session",
    });
  });
  expect(mocks.createSession).toHaveBeenCalledWith("");
  expect(mocks.setSessionNoteType).not.toHaveBeenCalled();
});

it("creates nothing when cancelled", () => {
  renderDialog();
  act(() => openNewNote());

  fireEvent.change(nameField(), { target: { value: "Draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.createSession).not.toHaveBeenCalled();
});

it("keeps the dialog open without opening a tab when creation fails", async () => {
  mocks.createSession.mockRejectedValueOnce(new Error("disk full"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  renderDialog();
  act(() => openNewNote());

  fireEvent.submit(nameField().closest("form")!);

  expect(await screen.findByRole("alert")).not.toBeNull();
  expect(screen.getByRole("dialog")).not.toBeNull();
  expect(useTabs.getState().currentTab?.type).not.toBe("sessions");
});
