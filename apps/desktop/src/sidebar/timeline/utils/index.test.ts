import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  buildTimelineBuckets,
  calculateTodayIndicatorPlacement,
  filterTimelineSessionsByFolder,
  getBucketInfo,
  type TimelineSessionsTable,
} from ".";

process.env.TZ = "UTC";

const SYSTEM_TIME = new Date("2024-01-15T12:00:00.000Z");

describe("timeline utils", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SYSTEM_TIME);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test.each([
    ["2024-01-15T05:00:00.000Z", "Today", "time"],
    ["2024-01-10T05:00:00.000Z", "5 days ago", "time"],
    ["2024-03-20T12:00:00.000Z", "in 2 months", "date"],
  ])("getBucketInfo(%s) is %s", (date, label, precision) => {
    expect(getBucketInfo(new Date(date))).toMatchObject({ label, precision });
  });

  test.each([
    ["2024-01-15T11:30:00.000Z", { type: "before", index: 0 }],
    ["2024-01-15T13:00:00.000Z", { type: "after" }],
  ])(
    "calculateTodayIndicatorPlacement places now relative to a note created at %s",
    (createdAt, expected) => {
      const placement = calculateTodayIndicatorPlacement(
        [
          {
            item: {
              type: "session",
              id: "session-1",
              data: { title: "test", created_at: createdAt },
            },
            timestamp: new Date(createdAt),
          },
        ],
        SYSTEM_TIME,
      );

      expect(placement).toEqual(expected);
    },
  );

  test("buildTimelineBuckets excludes Today bucket when empty", () => {
    const buckets = buildTimelineBuckets({ timelineSessionsTable: null });

    const todayBucket = buckets.find((bucket) => bucket.label === "Today");
    expect(todayBucket).toBeUndefined();
  });

  test("buildTimelineBuckets sorts buckets by most recent first", () => {
    const timelineSessionsTable: TimelineSessionsTable = {
      "session-future": {
        title: "Future Session",
        created_at: "2024-01-16T09:00:00.000Z",
      },
      "session-past": {
        title: "Past Session",
        created_at: "2024-01-14T09:00:00.000Z",
      },
    };

    const buckets = buildTimelineBuckets({ timelineSessionsTable });

    expect(buckets.map((bucket) => bucket.label)).toEqual([
      "Tomorrow",
      "Yesterday",
    ]);
  });

  test("getBucketInfo: past month bucket sorts before all week buckets", () => {
    // Week buckets: absDays <= 27, Month buckets: absDays > 27
    // "4 weeks ago" = ~25-27 days ago, "a month ago" = 28+ days ago
    const weeksAgo4 = getBucketInfo(new Date("2023-12-19T12:00:00.000Z")); // 27 days ago (last day of week bucket)
    const monthAgo = getBucketInfo(new Date("2023-12-17T12:00:00.000Z")); // 29 days ago (first day of month bucket)

    expect(weeksAgo4.label).toBe("4 weeks ago");
    expect(monthAgo.label).toBe("a month ago");
    expect(monthAgo.sortKey).toBeLessThan(weeksAgo4.sortKey);
  });

  test("buildTimelineBuckets: future buckets sort correctly (weeks before months)", () => {
    const timelineSessionsTable: TimelineSessionsTable = {
      "session-2weeks": {
        title: "In 2 weeks",
        created_at: "2024-01-29T09:00:00.000Z", // 14 days -> "in 2 weeks"
      },
      "session-4weeks": {
        title: "In 4 weeks",
        created_at: "2024-02-11T09:00:00.000Z", // 27 days -> "in 4 weeks"
      },
      "session-nextmonth": {
        title: "Next month",
        created_at: "2024-02-13T09:00:00.000Z", // 29 days -> "next month"
      },
    };

    const buckets = buildTimelineBuckets({ timelineSessionsTable });

    // Should be: next month, in 4 weeks, in 2 weeks (furthest future first)
    expect(buckets.map((b) => b.label)).toEqual([
      "next month",
      "in 4 weeks",
      "in 2 weeks",
    ]);
  });

  test("filterTimelineSessionsByFolder keeps sessions in the folder and its subfolders", () => {
    const filtered = filterTimelineSessionsByFolder(
      {
        "session-class": {
          title: "Lecture 3",
          created_at: "2024-01-15T11:00:00.000Z",
          folder_id: "CS 101",
        },
        "session-nested": {
          title: "Lab",
          created_at: "2024-01-15T12:00:00.000Z",
          folder_id: "CS 101/week-3",
        },
        "session-other": {
          title: "Standup",
          created_at: "2024-01-15T13:00:00.000Z",
          folder_id: "work",
        },
        "session-unfiled": {
          title: "Scratch",
          created_at: "2024-01-15T14:00:00.000Z",
          folder_id: "",
        },
      },
      "CS 101",
    );

    expect(Object.keys(filtered ?? {})).toEqual([
      "session-class",
      "session-nested",
    ]);
  });

  test("filterTimelineSessionsByFolder can isolate unfiled notes", () => {
    const filtered = filterTimelineSessionsByFolder(
      {
        "session-class": {
          title: "Lecture 3",
          created_at: "2024-01-15T11:00:00.000Z",
          folder_id: "CS 101",
        },
        "session-unfiled": {
          title: "Scratch",
          created_at: "2024-01-15T14:00:00.000Z",
          folder_id: "",
        },
      },
      "",
    );

    expect(Object.keys(filtered ?? {})).toEqual(["session-unfiled"]);
  });

  test("buildTimelineBuckets can reverse date order", () => {
    const timelineSessionsTable: TimelineSessionsTable = {
      "session-future": {
        title: "Future Session",
        created_at: "2024-01-16T09:00:00.000Z",
      },
      "session-past": {
        title: "Past Session",
        created_at: "2024-01-14T09:00:00.000Z",
      },
    };

    const buckets = buildTimelineBuckets({
      sortOrder: "oldest",
      timelineSessionsTable,
    });

    expect(buckets.map((bucket) => bucket.label)).toEqual([
      "Yesterday",
      "Tomorrow",
    ]);
    expect(buckets[0]?.items[0]).toMatchObject({ id: "session-past" });
  });

  test("buildTimelineBuckets groups notes by folder", () => {
    const buckets = buildTimelineBuckets({
      groupBy: "folder",
      timelineSessionsTable: {
        "session-work": {
          title: "Standup",
          created_at: "2024-01-15T13:00:00.000Z",
          folder_id: "work",
        },
        "session-class": {
          title: "Lecture 3",
          created_at: "2024-01-15T11:00:00.000Z",
          folder_id: "CS 101",
        },
        "session-unfiled": {
          title: "Scratch",
          created_at: "2024-01-15T14:00:00.000Z",
          folder_id: "",
        },
      },
    });

    expect(buckets.map((bucket) => bucket.label)).toEqual([
      "CS 101",
      "work",
      "No folder",
    ]);
    expect(buckets[0]?.items.map((item) => item.id)).toEqual(["session-class"]);
    expect(buckets[2]?.items.map((item) => item.id)).toEqual([
      "session-unfiled",
    ]);
  });

  test("buildTimelineBuckets keeps folder groups and sorts notes oldest first", () => {
    const buckets = buildTimelineBuckets({
      groupBy: "folder",
      sortOrder: "oldest",
      timelineSessionsTable: {
        "session-newer": {
          title: "Later note",
          created_at: "2024-01-15T14:00:00.000Z",
          folder_id: "CS 101",
        },
        "session-older": {
          title: "Earlier note",
          created_at: "2024-01-15T10:00:00.000Z",
          folder_id: "CS 101",
        },
      },
    });

    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.items.map((item) => item.id)).toEqual([
      "session-older",
      "session-newer",
    ]);
  });
});
