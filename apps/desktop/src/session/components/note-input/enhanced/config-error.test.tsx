import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const openNew = vi.hoisted(() => vi.fn());

vi.mock("~/store/zustand/tabs", () => ({
  useTabs: (selector: (state: { openNew: typeof openNew }) => unknown) =>
    selector({ openNew }),
}));

import { ConfigError } from "./config-error";

describe("ConfigError", () => {
  afterEach(() => {
    cleanup();
    openNew.mockReset();
  });

  it("opens AI settings from the empty summary state", () => {
    render(<ConfigError />);

    fireEvent.click(screen.getByRole("button", { name: "Set up AI" }));
    expect(openNew).toHaveBeenCalledWith({
      type: "settings",
      state: { tab: "intelligence" },
    });
  });
});
