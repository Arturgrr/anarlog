import { renderHook } from "@testing-library/react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

const db = vi.hoisted(() => ({
  current: null as InstanceType<typeof DatabaseSync> | null,
}));

vi.mock("@anlg/plugin-session", () => ({ commands: {} }));

vi.mock("~/db", () => ({
  useLiveQuery: ({
    sql,
    params = [],
    mapRows,
  }: {
    sql: string;
    params?: string[];
    mapRows: (rows: unknown[]) => unknown;
  }) => ({ data: mapRows(db.current!.prepare(sql).all(...params)) }),
}));

import { useSessionParticipants } from "./participants";

beforeEach(() => {
  db.current = new DatabaseSync(":memory:");
  db.current.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, owner_user_id TEXT);
    CREATE TABLE session_participants (
      id TEXT PRIMARY KEY, session_id TEXT, human_id TEXT, source TEXT,
      display_name TEXT, email TEXT, deleted_at TEXT
    );
    CREATE TABLE humans (
      id TEXT PRIMARY KEY, owner_user_id TEXT, name TEXT, email TEXT,
      job_title TEXT, linkedin_username TEXT, organization_id TEXT,
      deleted_at TEXT
    );
    CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT, deleted_at TEXT);
    INSERT INTO sessions VALUES ('session-1', 'owner-1');
    INSERT INTO organizations VALUES ('org-1', 'Acme', NULL);
    INSERT INTO humans VALUES
      ('owner-1', 'owner-1', 'Ada Owner', 'ada@example.com', 'CEO', 'ada', 'org-1', NULL),
      ('human-1', 'owner-1', 'Alice', 'alice@example.com', 'Engineer', '', '', NULL);
    INSERT INTO session_participants VALUES
      ('mapping-self', 'session-1', 'owner-1', 'manual', 'Ada Owner', 'ada@example.com', NULL),
      ('mapping-1', 'session-1', 'human-1', 'manual', 'Alice', '', NULL);
  `);
});

afterEach(() => {
  db.current?.close();
});

it("presents the local user as a participant without their profile", () => {
  const { result } = renderHook(() => useSessionParticipants("session-1"));

  expect(result.current).toEqual([
    {
      id: "mapping-self",
      sessionId: "session-1",
      humanId: "owner-1",
      source: "manual",
      name: "",
      email: "",
      jobTitle: "",
      linkedinUsername: "",
      organizationId: "",
      organizationName: "",
      isSelf: true,
    },
    expect.objectContaining({
      humanId: "human-1",
      name: "Alice",
      jobTitle: "Engineer",
      isSelf: false,
    }),
  ]);
});
