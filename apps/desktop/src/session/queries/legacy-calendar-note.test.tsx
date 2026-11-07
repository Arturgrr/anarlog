import { renderHook, waitFor } from "@testing-library/react";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

import { useSession } from "./sessions";

import { useTimelineSessionsTable } from "~/sidebar/timeline/queries";
import {
  buildTimelineBuckets,
  getItemTimestamp,
} from "~/sidebar/timeline/utils";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock("~/db", async () => {
  const { createUseLiveQuery } = await import("@anlg/db-react");
  return {
    executeTransaction: vi.fn(),
    liveQueryClient: mocks,
    useLiveQuery: createUseLiveQuery(mocks),
  };
});

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

it("opens and lists a note linked to a calendar event from before calendar removal", async () => {
  const database = new DatabaseSync(":memory:");
  const createdAt = "2026-10-01T09:00:00.000Z";
  const body = JSON.stringify({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Agenda" }] },
    ],
  });

  database.exec(`
    CREATE TABLE sessions (
      id TEXT, owner_user_id TEXT, created_at TEXT, folder_path TEXT,
      event_id TEXT, event_json TEXT, title TEXT, locked INTEGER, deleted_at TEXT
    );
    CREATE TABLE session_documents (
      id TEXT, kind TEXT, body TEXT, body_format TEXT, template_id TEXT,
      deleted_at TEXT
    );
    CREATE TABLE session_tags (session_id TEXT, tag_id TEXT, deleted_at TEXT);
    CREATE TABLE tags (id TEXT, name TEXT, deleted_at TEXT);
    CREATE TABLE events (
      id TEXT, tracking_id_event TEXT, calendar_id TEXT, title TEXT,
      started_at TEXT, ended_at TEXT, deleted_at TEXT
    );
    INSERT INTO events VALUES (
      'event-1', 'external-event-1', 'calendar-1', 'Planning',
      '2026-10-05T09:00:00.000Z', '2026-10-05T10:00:00.000Z', NULL
    );
  `);
  database
    .prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)")
    .run(
      "session-1",
      "user-1",
      createdAt,
      "",
      "event-1",
      JSON.stringify({
        tracking_id: "external-event-1",
        calendar_id: "calendar-1",
        title: "Planning",
        started_at: "2026-10-05T09:00:00.000Z",
        ended_at: "2026-10-05T10:00:00.000Z",
        is_all_day: false,
        has_recurrence_rules: false,
      }),
      "My planning note",
      0,
    );
  database
    .prepare(
      "INSERT INTO session_documents VALUES (?, 'note', ?, 'prosemirror_json', '', NULL)",
    )
    .run("session-1", body);

  mocks.subscribe.mockImplementation(
    async (
      sql: string,
      params: string[],
      callbacks: { onData: (rows: unknown[]) => void },
    ) => {
      callbacks.onData(database.prepare(sql).all(...params));
      return async () => {};
    },
  );

  const { result, unmount } = renderHook(() => ({
    session: useSession("session-1"),
    timeline: useTimelineSessionsTable(),
  }));

  await waitFor(() => expect(result.current.session).not.toBeNull());
  expect(result.current.session).toMatchObject({
    id: "session-1",
    title: "My planning note",
    raw_md: body,
    created_at: createdAt,
  });

  await waitFor(() =>
    expect(Object.keys(result.current.timeline ?? {})).toEqual(["session-1"]),
  );
  const [item] = buildTimelineBuckets({
    timelineSessionsTable: result.current.timeline,
  }).flatMap((bucket) => bucket.items);
  expect(item?.data.title).toBe("My planning note");
  expect(item && getItemTimestamp(item)?.toISOString()).toBe(createdAt);

  unmount();
  database.close();
});
