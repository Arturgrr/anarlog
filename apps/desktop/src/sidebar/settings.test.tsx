import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentTab: { type: "settings", state: { tab: "app" } } as {
    type: "settings";
    state: { tab?: string };
  } | null,
  tabs: [] as Array<{
    active: boolean;
    pinned: boolean;
    slotId: string;
    type: "templates";
    state: {
      showHomepage: boolean;
      isWebMode: boolean;
      selectedMineId: string | null;
      selectedWebIndex: number | null;
    };
  }>,
  openNew: vi.fn(),
  select: vi.fn(),
  transitionChatMode: vi.fn(),
  updateSettingsTabState: vi.fn(),
  updateTemplatesTabState: vi.fn(),
}));

const lingui = vi.hoisted(() => {
  const t = (
    input: TemplateStringsArray | { message?: string } | string,
    ...values: unknown[]
  ) => {
    if (Array.isArray(input)) {
      return input.reduce(
        (message, part, index) =>
          `${message}${part}${index < values.length ? String(values[index]) : ""}`,
        "",
      );
    }

    if (typeof input === "string") {
      return input;
    }

    if ("message" in input) {
      return input.message ?? "";
    }

    return "";
  };

  return { t };
});

vi.mock("@lingui/react/macro", () => ({
  Trans: ({
    children,
    id,
    message,
  }: {
    children?: ReactNode;
    id?: string;
    message?: string;
  }) => <>{children ?? message ?? id}</>,
  useLingui: () => ({
    _: lingui.t,
    t: lingui.t,
  }),
}));

vi.mock("./custom-sidebar-header", () => ({
  CustomSidebarHeader: () => <div />,
}));

vi.mock("~/store/zustand/tabs", () => {
  const getState = () => ({
    currentTab: mocks.currentTab,
    tabs: mocks.tabs,
    openNew: mocks.openNew,
    select: mocks.select,
    transitionChatMode: mocks.transitionChatMode,
    updateSettingsTabState: mocks.updateSettingsTabState,
    updateTemplatesTabState: mocks.updateTemplatesTabState,
  });
  const useTabs = Object.assign(
    (selector: (state: unknown) => unknown) => selector(getState()),
    { getState },
  );

  return {
    useTabs,
  };
});

import { SettingsNav } from "./settings";

describe("SettingsNav", () => {
  afterEach(cleanup);

  beforeEach(() => {
    mocks.currentTab = { type: "settings", state: { tab: "app" } };
    mocks.tabs = [];
    mocks.openNew.mockClear();
    mocks.select.mockClear();
    mocks.transitionChatMode.mockClear();
    mocks.updateSettingsTabState.mockClear();
    mocks.updateTemplatesTabState.mockClear();
  });

  const openedSettingsTab = () =>
    mocks.updateSettingsTabState.mock.lastCall?.[1] as
      | { tab: string }
      | undefined;

  it.each([
    ["Permissions", "permissions"],
    ["Dictation", "dictation"],
  ])("opens %s inside settings", (label, tab) => {
    render(<SettingsNav />);

    fireEvent.click(screen.getByRole("button", { name: label }));

    expect(mocks.updateSettingsTabState).toHaveBeenCalledWith(
      mocks.currentTab,
      { tab },
    );
  });

  it.each([
    ["Calendar", "calendar"],
    ["Automations", "automations"],
  ])("opens the %s workspace in a new tab", (label, type) => {
    render(<SettingsNav />);

    fireEvent.click(screen.getByRole("button", { name: label }));

    expect(mocks.openNew).toHaveBeenCalledWith({ type });
  });

  it("offers Insights instead of Stats, including via search", () => {
    render(<SettingsNav />);
    expect(screen.queryByRole("button", { name: "Stats" })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Search settings..."), {
      target: { value: "insights" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Insights" }));

    expect(openedSettingsTab()).toEqual({ tab: "insights" });
    expect(screen.queryByRole("button", { name: "Stats" })).toBeNull();
  });

  it("filters nav items by item or group label", () => {
    render(<SettingsNav />);
    const input = screen.getByPlaceholderText("Search settings...");

    fireEvent.change(input, { target: { value: "appear" } });
    expect(screen.getByText("Appearance")).toBeTruthy();
    expect(screen.queryByText("Meetings")).toBeNull();

    fireEvent.change(input, { target: { value: "workspace" } });
    expect(screen.getByText("Meetings")).toBeTruthy();
    expect(screen.getByText("Templates")).toBeTruthy();
    expect(screen.queryByText("Appearance")).toBeNull();
  });

  it("shows an empty state when no settings match", () => {
    render(<SettingsNav />);

    fireEvent.change(screen.getByPlaceholderText("Search settings..."), {
      target: { value: "zzzzzz" },
    });

    expect(screen.getByText("No results found.")).toBeTruthy();
  });

  it.each([
    [
      "the clear button",
      () => {
        fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
      },
    ],
    [
      "Escape",
      () => {
        fireEvent.keyDown(screen.getByPlaceholderText("Search settings..."), {
          key: "Escape",
        });
      },
    ],
  ])("restores the full list when search is cleared with %s", (_, clear) => {
    render(<SettingsNav />);

    fireEvent.change(screen.getByPlaceholderText("Search settings..."), {
      target: { value: "audio" },
    });
    expect(screen.queryByText("Appearance")).toBeNull();

    clear();

    expect(screen.getByText("Appearance")).toBeTruthy();
  });
});
