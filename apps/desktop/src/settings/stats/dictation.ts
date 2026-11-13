import { format, subDays } from "date-fns";

import { TZDate } from "@anlg/utils";

import type { DictationStatsRow } from "./dictation-queries";

const TOP_APPS = 5;

export function summarizeDictations(
  rows: DictationStatsRow[],
  now: Date,
  timezone?: string,
) {
  const segmenters = new Map<string, Intl.Segmenter>();
  const countWords = (text: string, language: string | null) => {
    if (typeof Intl.Segmenter !== "function") {
      return text.split(/\s+/u).filter(Boolean).length;
    }
    const key = language?.trim() ?? "";
    let segmenter = segmenters.get(key);
    if (!segmenter) {
      try {
        segmenter = new Intl.Segmenter(key || undefined, {
          granularity: "word",
        });
      } catch {
        segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
      }
      segmenters.set(key, segmenter);
    }
    let count = 0;
    for (const segment of segmenter.segment(text)) {
      if (segment.isWordLike) count += 1;
    }
    return count;
  };

  let words = 0;
  let timedWords = 0;
  let timedMs = 0;
  const days = new Set<string>();
  const apps = new Map<
    string,
    { name: string; count: number; latest: string; id: string }
  >();

  for (const row of rows) {
    const text = row.final_text.trim() ? row.final_text : row.raw_text;
    const count = countWords(text, row.language);
    words += count;
    const duration = Number(row.duration_ms);
    if (Number.isFinite(duration) && duration > 0) {
      timedWords += count;
      timedMs += duration;
    }

    const createdAt = Date.parse(row.created_at);
    if (Number.isFinite(createdAt)) {
      days.add(
        format(
          timezone ? new TZDate(createdAt, timezone) : new Date(createdAt),
          "yyyy-MM-dd",
        ),
      );
    }

    const id = row.target_app_id?.trim();
    const name = row.target_app_name?.trim();
    const key = id ? `id:${id}` : name ? `name:${name}` : null;
    if (!key) continue;
    const app = apps.get(key) ?? {
      name: "",
      count: 0,
      latest: "",
      id: id ?? "",
    };
    app.count += 1;
    if (name && row.created_at >= app.latest) {
      app.name = name;
      app.latest = row.created_at;
    }
    apps.set(key, app);
  }

  const localNow = timezone ? new TZDate(now, timezone) : now;
  let day = days.has(format(localNow, "yyyy-MM-dd"))
    ? localNow
    : subDays(localNow, 1);
  let streakDays = 0;
  while (days.has(format(day, "yyyy-MM-dd"))) {
    streakDays += 1;
    day = subDays(day, 1);
  }

  return {
    dictations: rows.length,
    words,
    wordsPerMinute:
      timedMs > 0 ? Math.round(timedWords / (timedMs / 60_000)) : null,
    streakDays,
    activeDays: days.size,
    topApps: [...apps.values()]
      .map(({ name, id, count }) => ({ name: name || id, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, TOP_APPS),
  };
}
