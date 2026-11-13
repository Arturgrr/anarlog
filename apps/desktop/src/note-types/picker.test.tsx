import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./queries", () => ({
  createNoteType: vi.fn(),
  useNoteTypes: () => [
    { id: "a1b2", name: "Class", parentId: null },
    { id: "9z", name: "Standup", parentId: null },
  ],
}));

import { NoteTypePicker } from "./picker";

describe("NoteTypePicker", () => {
  afterEach(cleanup);

  Element.prototype.scrollIntoView ??= () => {};

  it("matches the search against type names, not their ids", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NoteTypePicker
          value={{ typeId: null, subtypeId: null }}
          onChange={() => {}}
          allowCreate={false}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Type" }));

    const search = screen.getByPlaceholderText("Search types");

    fireEvent.change(search, { target: { value: "9" } });
    expect(screen.queryAllByRole("option")).toEqual([]);

    fireEvent.change(search, { target: { value: "stand" } });
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Standup"]);
  });
});
