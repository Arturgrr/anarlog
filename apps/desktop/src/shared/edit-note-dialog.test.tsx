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
  renameSession: vi.fn(),
  getSessionNoteType: vi.fn(),
  setSessionNoteType: vi.fn(),
}));

vi.mock("~/session/rename", () => ({
  renameSession: mocks.renameSession,
}));

vi.mock("~/note-types/queries", () => ({
  getSessionNoteType: mocks.getSessionNoteType,
  setSessionNoteType: mocks.setSessionNoteType,
}));

vi.mock("~/note-types/picker", () => ({
  NoteTypePicker: ({
    value,
    onChange,
  }: {
    value: { typeId: string | null };
    onChange: (next: { typeId: string; subtypeId: string }) => void;
  }) => (
    <button
      type="button"
      onClick={() => onChange({ typeId: "interview", subtypeId: "screen" })}
    >
      {`Type: ${value.typeId ?? "none"}`}
    </button>
  ),
}));

import { EditNoteDialog } from "./edit-note-dialog";
import { openEditNote, useEditNoteDialog } from "./useEditNote";

import { useLiveTitle } from "~/store/zustand/live-title";

function renderDialog() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <EditNoteDialog />
    </QueryClientProvider>,
  );
}

async function openFor(sessionId: string, storeTitle: string) {
  renderDialog();
  act(() => openEditNote({ sessionId, storeTitle }));
  return screen.findByPlaceholderText("Untitled");
}

beforeEach(() => {
  vi.clearAllMocks();
  useEditNoteDialog.setState({ request: null });
  useLiveTitle.setState({ titles: {} });
  mocks.renameSession.mockResolvedValue(undefined);
  mocks.setSessionNoteType.mockResolvedValue(undefined);
  mocks.getSessionNoteType.mockResolvedValue({
    typeId: "class",
    subtypeId: null,
  });
});

afterEach(() => {
  cleanup();
});

it("saves a changed name and type, prefilled from the pending title draft", async () => {
  useLiveTitle.getState().setTitle("live-note", "Draft name");
  const name = await openFor("live-note", "Stored name");

  expect((name as HTMLInputElement).value).toBe("Draft name");
  expect(screen.getByRole("button", { name: "Type: class" })).not.toBeNull();

  fireEvent.change(name, { target: { value: " Customer call " } });
  fireEvent.click(screen.getByRole("button", { name: "Type: class" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.renameSession).toHaveBeenCalledWith(
    "live-note",
    "Customer call",
  );
  expect(mocks.setSessionNoteType).toHaveBeenCalledWith("live-note", {
    typeId: "interview",
    subtypeId: "screen",
  });
  expect(useLiveTitle.getState().titles["live-note"]?.value).toBe(
    "Customer call",
  );
});

it("stores an empty name as untitled and leaves an unchanged type alone", async () => {
  const name = await openFor("note-1", "Weekly sync");

  fireEvent.change(name, { target: { value: "  " } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.renameSession).toHaveBeenCalledWith("note-1", "");
  expect(mocks.setSessionNoteType).not.toHaveBeenCalled();
});

it("changes nothing when cancelled", async () => {
  const name = await openFor("note-1", "Weekly sync");

  fireEvent.change(name, { target: { value: "Renamed" } });
  fireEvent.click(screen.getByRole("button", { name: "Type: class" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.renameSession).not.toHaveBeenCalled();
  expect(mocks.setSessionNoteType).not.toHaveBeenCalled();
});

it("keeps the dialog and what was typed when saving fails", async () => {
  mocks.renameSession.mockRejectedValueOnce(new Error("database locked"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const name = await openFor("note-1", "Weekly sync");

  fireEvent.change(name, { target: { value: "Renamed" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("alert")).not.toBeNull();
  expect(screen.getByRole("dialog")).not.toBeNull();
  expect(
    (screen.getByPlaceholderText("Untitled") as HTMLInputElement).value,
  ).toBe("Renamed");
  expect(useLiveTitle.getState().titles["note-1"]).toBeUndefined();
});
