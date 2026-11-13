import { describe, expect, it } from "vitest";

import { summarizeDictations } from "./dictation";
import type { DictationStatsRow } from "./dictation-queries";

const now = new Date("2026-09-05T12:00:00Z");
const row = (overrides: Partial<DictationStatsRow>): DictationStatsRow => ({
  created_at: "2026-09-05T09:00:00Z",
  duration_ms: 0,
  target_app_name: null,
  target_app_id: null,
  language: null,
  raw_text: "",
  final_text: "",
  ...overrides,
});

describe("dictation statistics", () => {
  it("counts words from the final text, falling back to the transcript, in languages without spaces", () => {
    const stats = summarizeDictations(
      [
        row({ final_text: "Hello there, world.", raw_text: "hello world" }),
        row({ final_text: "  ", raw_text: "falls back to raw" }),
        row({ final_text: "今日はいい天気です", language: "ja" }),
        row({ final_text: "one two", language: "en,pt" }),
      ],
      now,
      "UTC",
    );
    expect(stats).toMatchObject({ dictations: 4, words: 3 + 4 + 5 + 2 });
  });

  it("divides total words by total recorded minutes, ignoring dictations without a duration", () => {
    const words = (count: number) => "word ".repeat(count);
    const timed = summarizeDictations(
      [
        row({ final_text: words(30), duration_ms: 60_000 }),
        row({ final_text: words(10), duration_ms: 0 }),
        row({ final_text: words(30), duration_ms: 120_000 }),
      ],
      now,
      "UTC",
    );
    expect(timed.wordsPerMinute).toBe(20);
    expect(
      summarizeDictations([row({ final_text: words(5) })], now, "UTC")
        .wordsPerMinute,
    ).toBeNull();
  });

  it("counts the streak in calendar days of the configured timezone", () => {
    const rows = [
      "2026-09-04T16:00:00Z",
      "2026-09-03T16:00:00Z",
      "2026-09-03T14:00:00Z",
    ].map((created_at) => row({ created_at, final_text: "hi" }));
    expect(summarizeDictations(rows, now, "Asia/Seoul")).toMatchObject({
      streakDays: 3,
      activeDays: 3,
    });
    expect(summarizeDictations(rows, now, "UTC")).toMatchObject({
      streakDays: 2,
      activeDays: 2,
    });
  });

  it("keeps a streak that ended yesterday and drops one that ended earlier", () => {
    const at = (created_at: string) => row({ created_at, final_text: "hi" });
    expect(
      summarizeDictations(
        [at("2026-09-04T08:00:00Z"), at("2026-09-03T08:00:00Z")],
        now,
        "UTC",
      ).streakDays,
    ).toBe(2);
    expect(
      summarizeDictations([at("2026-09-03T08:00:00Z")], now, "UTC").streakDays,
    ).toBe(0);
  });

  it("ranks the top five apps by bundle id with their newest name, skipping unnamed targets", () => {
    const app = (
      target_app_name: string | null,
      target_app_id: string | null = null,
      created_at = "2026-09-05T09:00:00Z",
    ) => row({ target_app_name, target_app_id, created_at, final_text: "hi" });
    const stats = summarizeDictations(
      [
        app("Apple Notes", "com.apple.Notes", "2026-09-04T09:00:00Z"),
        app("Notes", "com.apple.Notes", "2026-09-01T09:00:00Z"),
        app(null, "com.apple.Notes", "2026-09-05T09:00:00Z"),
        app("Slack"),
        app("Slack"),
        app("Zed"),
        app("Xcode"),
        app("Mail"),
        app("Arc"),
        app("  ", " "),
        app(null),
      ],
      now,
      "UTC",
    );
    expect(stats.dictations).toBe(11);
    expect(stats.topApps).toEqual([
      { name: "Apple Notes", count: 3 },
      { name: "Slack", count: 2 },
      { name: "Arc", count: 1 },
      { name: "Mail", count: 1 },
      { name: "Xcode", count: 1 },
    ]);
  });

  it("reports nothing for an empty history", () => {
    expect(summarizeDictations([], now, "UTC")).toEqual({
      dictations: 0,
      words: 0,
      wordsPerMinute: null,
      streakDays: 0,
      activeDays: 0,
      topApps: [],
    });
  });
});
