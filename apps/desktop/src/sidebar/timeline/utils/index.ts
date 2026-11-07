import { t } from "@lingui/core/macro";

import {
  differenceInCalendarDays,
  differenceInCalendarMonths,
  safeParseDate,
  startOfDay,
  startOfMonth,
  TZDate,
} from "@anlg/utils";

import {
  folderPathMatchesFilter,
  normalizeFolderPath,
} from "~/session/folders";

export type TimelineGroupBy = "date" | "folder";
export type TimelineSortOrder = "newest" | "oldest";

function toTZ(date: Date, timezone?: string): Date {
  return timezone ? new TZDate(date, timezone) : date;
}

export type TimelineSessionRow = {
  title?: string | null;
  created_at?: string | null;
  folder_id?: string | null;
  locked?: boolean | number | null;
  tags?: string[];
};

export type TimelineSessionsTable =
  | Record<string, TimelineSessionRow>
  | null
  | undefined;

export type TimelineItem = {
  type: "session";
  id: string;
  data: TimelineSessionRow;
};

export type TimelinePrecision = "time" | "date";

export type TimelineBucket = {
  label: string;
  precision: TimelinePrecision;
  items: TimelineItem[];
};

export type TimelineIndicatorPlacement =
  | { type: "before"; index: number }
  | { type: "after" };

export function getBucketInfo(
  date: Date,
  timezone?: string,
): {
  label: string;
  sortKey: number;
  precision: TimelinePrecision;
} {
  const now = new Date();
  const tzDate = toTZ(date, timezone);
  const tzNow = toTZ(now, timezone);
  const daysDiff = differenceInCalendarDays(tzDate, tzNow);
  const sortKey = startOfDay(tzDate).getTime();
  const absDays = Math.abs(daysDiff);

  if (daysDiff === 0) {
    return { label: t`Today`, sortKey, precision: "time" };
  }

  if (daysDiff === -1) {
    return { label: t`Yesterday`, sortKey, precision: "time" };
  }

  if (daysDiff === 1) {
    return { label: t`Tomorrow`, sortKey, precision: "time" };
  }

  if (daysDiff < 0) {
    if (absDays <= 6) {
      return { label: t`${absDays} days ago`, sortKey, precision: "time" };
    }

    if (absDays <= 27) {
      const weeks = Math.max(1, Math.round(absDays / 7));
      const weekRangeEndDay = Math.max(7, weeks * 7 - 3);
      const weekRangeEnd = new Date(
        now.getTime() - weekRangeEndDay * 24 * 60 * 60 * 1000,
      );
      const weekSortKey = startOfDay(toTZ(weekRangeEnd, timezone)).getTime();

      return {
        label: weeks === 1 ? t`a week ago` : t`${weeks} weeks ago`,
        sortKey: weekSortKey,
        precision: "date",
      };
    }

    let months = Math.abs(differenceInCalendarMonths(tzDate, tzNow));
    if (months === 0) {
      months = 1;
    }
    const monthStartKey = startOfMonth(tzDate).getTime();
    const lastDayInMonthBucket = new Date(
      now.getTime() - 28 * 24 * 60 * 60 * 1000,
    );
    const lastDayKey = startOfDay(
      toTZ(lastDayInMonthBucket, timezone),
    ).getTime();
    const monthSortKey = Math.min(monthStartKey, lastDayKey);
    return {
      label: months === 1 ? t`a month ago` : t`${months} months ago`,
      sortKey: monthSortKey,
      precision: "date",
    };
  }

  if (absDays <= 6) {
    return { label: t`in ${absDays} days`, sortKey, precision: "time" };
  }

  if (absDays <= 27) {
    const weeks = Math.max(1, Math.round(absDays / 7));
    const weekRangeStartDay = Math.max(7, weeks * 7 - 3);
    const weekRangeStart = new Date(
      now.getTime() + weekRangeStartDay * 24 * 60 * 60 * 1000,
    );
    const weekSortKey = startOfDay(toTZ(weekRangeStart, timezone)).getTime();

    return {
      label: weeks === 1 ? t`next week` : t`in ${weeks} weeks`,
      sortKey: weekSortKey,
      precision: "date",
    };
  }

  let months = differenceInCalendarMonths(tzDate, tzNow);
  if (months === 0) {
    months = 1;
  }
  const monthStartKey = startOfMonth(tzDate).getTime();
  const firstDayInMonthBucket = new Date(
    now.getTime() + 28 * 24 * 60 * 60 * 1000,
  );
  const firstDayKey = startOfDay(
    toTZ(firstDayInMonthBucket, timezone),
  ).getTime();
  const monthSortKey = Math.max(monthStartKey, firstDayKey);
  return {
    label: months === 1 ? t`next month` : t`in ${months} months`,
    sortKey: monthSortKey,
    precision: "date",
  };
}

function calculateIndicatorIndex(
  entries: Array<{ timestamp: Date | null }>,
  current: Date,
  sortOrder: TimelineSortOrder = "newest",
): number {
  const index = entries.findIndex(({ timestamp }) => {
    if (!timestamp) {
      return true;
    }

    return sortOrder === "oldest"
      ? timestamp.getTime() >= current.getTime()
      : timestamp.getTime() < current.getTime();
  });

  if (index === -1) {
    return entries.length;
  }

  return index;
}

export function getItemTimestamp(item: TimelineItem): Date | null {
  return safeParseDate(item.data.created_at);
}

export function calculateTodayIndicatorPlacement(
  entries: Array<{ item: TimelineItem; timestamp: Date | null }>,
  current: Date,
  sortOrder: TimelineSortOrder = "newest",
): TimelineIndicatorPlacement {
  const indicatorIndex = calculateIndicatorIndex(entries, current, sortOrder);
  if (indicatorIndex === entries.length) {
    return { type: "after" };
  }

  return { type: "before", index: indicatorIndex };
}

export function filterTimelineSessionsByFolder(
  timelineSessionsTable: TimelineSessionsTable,
  folderFilter: string | null,
): TimelineSessionsTable {
  if (folderFilter === null || !timelineSessionsTable) {
    return timelineSessionsTable;
  }

  return Object.fromEntries(
    Object.entries(timelineSessionsTable).filter(([, row]) =>
      folderPathMatchesFilter(row.folder_id, folderFilter),
    ),
  );
}

function collectTimelineItems(
  timelineSessionsTable: TimelineSessionsTable,
): TimelineItem[] {
  if (!timelineSessionsTable) {
    return [];
  }

  return Object.entries(timelineSessionsTable).flatMap(([sessionId, row]) =>
    safeParseDate(row.created_at)
      ? [{ type: "session" as const, id: sessionId, data: row }]
      : [],
  );
}

function compareTimelineItems(
  left: TimelineItem,
  right: TimelineItem,
  sortOrder: TimelineSortOrder,
): number {
  const timeAValue = getItemTimestamp(left)?.getTime() ?? 0;
  const timeBValue = getItemTimestamp(right)?.getTime() ?? 0;
  if (timeAValue !== timeBValue) {
    return sortOrder === "newest"
      ? timeBValue - timeAValue
      : timeAValue - timeBValue;
  }

  return (left.data.title ?? "Untitled").localeCompare(
    right.data.title ?? "Untitled",
  );
}

function folderBucketKey(item: TimelineItem): string {
  return normalizeFolderPath(item.data.folder_id ?? "") ?? "";
}

function buildFolderBuckets(items: TimelineItem[]): TimelineBucket[] {
  const bucketMap = new Map<string, TimelineItem[]>();

  for (const item of items) {
    const key = folderBucketKey(item);
    const bucketItems = bucketMap.get(key);
    if (bucketItems) {
      bucketItems.push(item);
      continue;
    }
    bucketMap.set(key, [item]);
  }

  return [...bucketMap.entries()]
    .sort(([left], [right]) => {
      if (left === "") {
        return 1;
      }
      if (right === "") {
        return -1;
      }
      return left.localeCompare(right);
    })
    .map(([key, bucketItems]) => ({
      label: key === "" ? t`No folder` : key,
      items: bucketItems,
      precision: "date" as const,
    }));
}

function buildDateBuckets({
  items,
  sortOrder,
  timezone,
}: {
  items: TimelineItem[];
  sortOrder: TimelineSortOrder;
  timezone?: string;
}): TimelineBucket[] {
  const bucketMap = new Map<
    string,
    { sortKey: number; precision: TimelinePrecision; items: TimelineItem[] }
  >();

  items.forEach((item) => {
    const bucket = getBucketInfo(
      getItemTimestamp(item) ?? new Date(0),
      timezone,
    );

    if (!bucketMap.has(bucket.label)) {
      bucketMap.set(bucket.label, {
        sortKey: bucket.sortKey,
        precision: bucket.precision,
        items: [],
      });
    }
    bucketMap.get(bucket.label)!.items.push(item);
  });

  return Array.from(bucketMap.entries())
    .sort((left, right) =>
      sortOrder === "newest"
        ? right[1].sortKey - left[1].sortKey
        : left[1].sortKey - right[1].sortKey,
    )
    .map(
      ([label, value]) =>
        ({
          label,
          items: value.items,
          precision: value.precision,
        }) satisfies TimelineBucket,
    );
}

export function buildTimelineBuckets({
  timelineSessionsTable,
  timezone,
  groupBy = "date",
  sortOrder = "newest",
}: {
  timelineSessionsTable: TimelineSessionsTable;
  timezone?: string;
  groupBy?: TimelineGroupBy;
  sortOrder?: TimelineSortOrder;
}): TimelineBucket[] {
  const items = collectTimelineItems(timelineSessionsTable);

  items.sort((left, right) => compareTimelineItems(left, right, sortOrder));

  if (groupBy === "folder") {
    return buildFolderBuckets(items);
  }

  return buildDateBuckets({ items, sortOrder, timezone });
}
