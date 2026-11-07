import { useMemo } from "react";

import { useLiveQuery } from "~/db";
import { parseSessionTagNames } from "~/sidebar/item-fields";
import type {
  TimelineSessionRow,
  TimelineSessionsTable,
} from "~/sidebar/timeline/utils";
import { useUndoDelete } from "~/store/zustand/undo-delete";

type TimelineSessionSqlRow = Omit<TimelineSessionRow, "tags"> & {
  id: string;
  tags_json?: string | null;
};

const EMPTY_SESSIONS: Record<string, TimelineSessionRow> = {};

export function useTimelineSessionsTable(): TimelineSessionsTable {
  const { data: timelineSessionsTable = EMPTY_SESSIONS } = useLiveQuery<
    TimelineSessionSqlRow,
    Record<string, TimelineSessionRow>
  >({
    sql: `
      SELECT
        id,
        title,
        created_at,
        folder_path AS folder_id,
        locked,
        COALESCE((
          SELECT json_group_array(tags.name)
          FROM session_tags
          INNER JOIN tags
            ON tags.id = session_tags.tag_id
            AND tags.deleted_at IS NULL
          WHERE session_tags.session_id = sessions.id
            AND session_tags.deleted_at IS NULL
        ), '[]') AS tags_json
      FROM sessions
      WHERE deleted_at IS NULL
      ORDER BY created_at, id
    `,
    mapRows: mapTimelineSessionRows,
  });
  const pendingDeletions = useUndoDelete((state) => state.pendingDeletions);

  // Sessions with a pending deletion are hidden optimistically, before the
  // soft-delete write commits and the live query re-emits.
  return useMemo(() => {
    const pendingIds = Object.keys(pendingDeletions).filter(
      (sessionId) => sessionId in timelineSessionsTable,
    );
    if (pendingIds.length === 0) return timelineSessionsTable;

    const filtered = { ...timelineSessionsTable };
    for (const sessionId of pendingIds) {
      delete filtered[sessionId];
    }
    return filtered;
  }, [timelineSessionsTable, pendingDeletions]);
}

export function mapTimelineSessionRows(
  rows: TimelineSessionSqlRow[],
): Record<string, TimelineSessionRow> {
  return Object.fromEntries(
    rows.map(({ id, tags_json, ...row }) => [
      id,
      {
        ...row,
        tags: parseSessionTagNames(tags_json),
      },
    ]),
  );
}
