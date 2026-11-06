import { useMemo } from "react";

import {
  buildTimelineBuckets,
  filterTimelineSessionsByFolder,
  getItemTimestamp,
  type TimelineBucket,
  type TimelineGroupBy,
  type TimelineSessionsTable,
  type TimelineSortOrder,
} from "./utils";

import { useCurrentDay } from "~/shared/hooks/useCurrentDay";

export function getFallbackIndicatorIndex(
  buckets: TimelineBucket[],
  nowMs: number,
  sortOrder: TimelineSortOrder = "newest",
) {
  if (sortOrder === "oldest") {
    for (let index = 0; index < buckets.length; index++) {
      const bucket = buckets[index];
      if (!bucket) {
        continue;
      }

      if (isFutureBucketLabel(bucket.label)) {
        return index;
      }

      const newestItem = bucket.items[bucket.items.length - 1];
      const itemDate = newestItem ? getItemTimestamp(newestItem) : null;
      if (itemDate && itemDate.getTime() >= nowMs) {
        return index;
      }
    }

    return -1;
  }

  let staleFutureBoundary: number | null = null;

  for (let index = 0; index < buckets.length; index++) {
    const bucket = buckets[index];
    const firstItem = bucket?.items[0];
    if (!bucket || !firstItem) {
      continue;
    }

    const itemDate = getItemTimestamp(firstItem);
    if (!itemDate || itemDate.getTime() >= nowMs) {
      continue;
    }

    if (isFutureBucketLabel(bucket.label)) {
      staleFutureBoundary = index + 1;
      continue;
    }

    return staleFutureBoundary ?? index;
  }

  return staleFutureBoundary ?? -1;
}

function isFutureBucketLabel(label: string) {
  return (
    label === "Tomorrow" ||
    label === "next week" ||
    label === "next month" ||
    label.startsWith("in ")
  );
}

export function useTimelineData({
  folderFilter = null,
  groupBy = "date",
  sortOrder = "newest",
  timelineSessionsTable,
  timezone,
}: {
  folderFilter?: string | null;
  groupBy?: TimelineGroupBy;
  sortOrder?: TimelineSortOrder;
  timelineSessionsTable: TimelineSessionsTable;
  timezone?: string;
}): TimelineBucket[] {
  const folderScopedSessions = useMemo(
    () => filterTimelineSessionsByFolder(timelineSessionsTable, folderFilter),
    [folderFilter, timelineSessionsTable],
  );
  // Date bucket labels are relative to today, so rebuild them when the day changes.
  const currentDay = useCurrentDay(timezone);

  return useMemo(
    () =>
      buildTimelineBuckets({
        groupBy,
        sortOrder,
        timelineSessionsTable: folderScopedSessions,
        timezone,
      }),
    [groupBy, sortOrder, folderScopedSessions, currentDay, timezone],
  );
}
