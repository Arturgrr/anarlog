import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openCurrent: vi.fn(),
  openNew: vi.fn(),
  onOpenChange: vi.fn(),
  sessions: [] as Array<{
    id: string;
    title: string;
    created_at: string;
  }>,
}));

vi.mock("~/annotate/system", () => ({
  annotateAvailable: () => false,
}));

vi.mock("~/session/queries", () => ({
  useSessionSummaries: () => mocks.sessions,
}));

vi.mock("~/store/zustand/tabs", () => ({
  useTabs: (
    selector: (state: {
      openCurrent: typeof mocks.openCurrent;
      openNew: typeof mocks.openNew;
      recentlyOpenedSessionIds: string[];
    }) => unknown,
  ) =>
    selector({
      openCurrent: mocks.openCurrent,
      openNew: mocks.openNew,
      recentlyOpenedSessionIds: [],
    }),
}));

import { OpenNoteDialog } from "./open-note-dialog";

describe("OpenNoteDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessions = [];
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver;
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(cleanup);

  it("closes through the shared dialog escape behavior", () => {
    render(<OpenNoteDialog open onOpenChange={mocks.onOpenChange} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens a local note from All Notes", () => {
    mocks.sessions = [
      {
        id: "local-session",
        title: "Owned canonical note",
        created_at: "2026-07-15T09:00:00.000Z",
      },
    ];

    render(<OpenNoteDialog open onOpenChange={mocks.onOpenChange} />);

    expect(
      screen.getByRole("dialog", { name: "Search notes and pages..." }),
    ).toBeTruthy();
    expect(
      document.querySelector("[data-open-note-dialog-drag-region]"),
    ).toBeTruthy();
    expect(screen.getByText("All Notes")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("option", { name: "Owned canonical note" }),
    );

    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.openCurrent).toHaveBeenCalledWith({
      type: "sessions",
      id: "local-session",
    });
  });

  it("shows top-level pages when the query is empty", () => {
    render(<OpenNoteDialog open onOpenChange={mocks.onOpenChange} />);

    expect(screen.getByText("Go to")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Contacts" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Settings" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Transcription" })).toBeNull();
  });

  it("opens a matching page from the global navigator", () => {
    render(<OpenNoteDialog open onOpenChange={mocks.onOpenChange} />);

    fireEvent.change(screen.getByPlaceholderText("Search notes and pages..."), {
      target: { value: "contact" },
    });
    fireEvent.click(screen.getByRole("option", { name: "Contacts" }));

    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.openNew).toHaveBeenCalledWith({ type: "contacts" });
  });

  it("opens a matching settings sub-page", () => {
    render(<OpenNoteDialog open onOpenChange={mocks.onOpenChange} />);

    fireEvent.change(screen.getByPlaceholderText("Search notes and pages..."), {
      target: { value: "transcription" },
    });
    fireEvent.click(screen.getByRole("option", { name: /Transcription/ }));

    expect(mocks.openNew).toHaveBeenCalledWith({
      type: "settings",
      state: { tab: "transcription" },
    });
  });

  it("shows an empty state when no pages or notes match", () => {
    render(<OpenNoteDialog open onOpenChange={mocks.onOpenChange} />);

    fireEvent.change(screen.getByPlaceholderText("Search notes and pages..."), {
      target: { value: "zzzz" },
    });

    expect(screen.getByText("No results found.")).toBeTruthy();
  });
});
