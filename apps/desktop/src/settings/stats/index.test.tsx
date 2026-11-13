import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DictationStatsRow } from "./dictation-queries";
import type { ActivityRecord } from "./queries";

const mocks = vi.hoisted(() => ({
  activity: {
    data: [] as ActivityRecord[],
    isLoading: false,
    error: null as Error | null,
  },
  dictations: {
    data: [] as DictationStatsRow[] | undefined,
    isLoading: false,
    error: null as Error | null,
  },
  retention: "week",
}));

vi.mock("./queries", () => ({ useActivity: () => mocks.activity }));
vi.mock("~/db", () => ({ useLiveQuery: () => mocks.dictations }));
vi.mock("~/shared/config", () => ({
  useConfigValue: () => mocks.retention,
}));
vi.mock("~/shared/hooks/useNow", () => ({
  useNow: () => new Date("2026-09-05T12:00:00Z"),
  useTimezone: () => "UTC",
  useWeekStartsOn: () => 1,
}));

import { SettingsInsights } from "./index";

describe("merged insights page", () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.activity = { data: [], isLoading: false, error: null };
    mocks.dictations = { data: [], isLoading: false, error: null };
    mocks.retention = "week";
  });

  it("waits for activity before showing totals", () => {
    mocks.activity.isLoading = true;
    const { rerender } = render(<SettingsInsights />);
    expect(screen.getByRole("status").textContent).toContain("Loading");
    expect(screen.queryByRole("region", { name: "Overview" })).toBeNull();
    mocks.activity.isLoading = false;
    rerender(<SettingsInsights />);
    expect(screen.getByRole("region", { name: "Overview" })).toBeTruthy();
  });

  it("filters totals without filtering the yearly heatmap", async () => {
    mocks.activity.data = ["2026-08-01T12:00:00Z", "2026-09-04T12:00:00Z"].map(
      (date, index) => ({
        session_id: String(index),
        created_at: date,
        started_at_ms: Date.parse(date),
        duration_ms: 3_600_000,
      }),
    );
    render(<SettingsInsights />);
    const overview = screen.getByRole("region", { name: "Overview" });
    expect(
      within(overview).getByText("Conversations").nextElementSibling
        ?.textContent,
    ).toBe("2");
    expect(screen.getByText("Conversations: 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(
      within(overview).getByText("Conversations").nextElementSibling
        ?.textContent,
    ).toBe("1");
    expect(screen.getByText("Conversations: 1")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "7 days" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    const day = screen.getByRole("listitem", {
      name: "August 1, 2026. Conversations: 1",
    });
    fireEvent.click(day);
    expect(
      await screen.findByText("August 1, 2026. Conversations: 1"),
    ).toBeTruthy();
  });

  it("reports query errors without showing misleading totals", () => {
    mocks.activity.error = new Error("Database unavailable");
    render(<SettingsInsights />);
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load");
    expect(screen.queryByText("Conversations")).toBeNull();
  });

  it("summarizes the dictations still kept, and says so when none are", () => {
    const dictation = (
      created_at: string,
      final_text: string,
      target_app_name: string | null = "Slack",
    ): DictationStatsRow => ({
      created_at,
      duration_ms: 30_000,
      target_app_name,
      target_app_id: null,
      language: "en",
      raw_text: final_text,
      final_text,
    });
    mocks.dictations.data = [
      dictation("2026-09-05T09:00:00.000Z", "one two three four"),
      dictation("2026-09-04T09:00:00.000Z", "five six", "Mail"),
      dictation("2026-08-20T09:00:00.000Z", "expired by retention"),
    ];
    const { rerender } = render(<SettingsInsights />);
    const section = screen.getByRole("region", { name: "Dictation" });
    const figure = (label: string) =>
      within(section).getByText(label).nextElementSibling?.textContent;
    expect(figure("Dictations")).toBe("2");
    expect(figure("Words")).toBe("6");
    expect(figure("Words per minute")).toBe("6");
    expect(figure("Day streak")).toBe("2");
    expect(
      within(within(section).getByRole("region", { name: "Most-used apps" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining("Mail"),
      expect.stringContaining("Slack"),
    ]);
    expect(within(section).getByText(/last 7 days/)).toBeTruthy();

    mocks.dictations.data = [];
    rerender(<SettingsInsights />);
    expect(within(section).queryByText("Dictations")).toBeNull();
    expect(within(section).getByText(/No saved dictations yet/)).toBeTruthy();

    mocks.retention = "off";
    rerender(<SettingsInsights />);
    expect(within(section).getByText(/Dictation history is off/)).toBeTruthy();
  });

  it("keeps the conversation insights when dictation statistics fail to load", () => {
    mocks.dictations = {
      data: undefined,
      isLoading: false,
      error: new Error("Database unavailable"),
    };
    render(<SettingsInsights />);
    expect(screen.getByRole("region", { name: "Overview" })).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Dictation" })).getByRole(
        "alert",
      ).textContent,
    ).toContain("Couldn't load your dictation statistics");
  });
});
