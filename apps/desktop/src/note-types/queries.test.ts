import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");
type Params = import("node:sqlite").SQLInputValue[];

const mocks = vi.hoisted(() => ({
  db: null as unknown as import("node:sqlite").DatabaseSync,
}));

vi.mock("~/db", () => ({
  liveQueryClient: {
    execute: async (sql: string, params: Params = []) =>
      mocks.db.prepare(sql).all(...params),
  },
  executeTransaction: async (statements: { sql: string; params: Params }[]) =>
    statements.map(({ sql, params }) =>
      Number(mocks.db.prepare(sql).run(...params).changes),
    ),
  useLiveQuery: vi.fn(),
}));

import {
  createNoteType,
  deleteNoteType,
  getSessionNoteType,
  listNoteTypes,
  setSessionNoteType,
} from "./queries";

describe("note types", () => {
  beforeEach(() => {
    mocks.db = new DatabaseSync(":memory:");
    mocks.db.exec(
      `CREATE TABLE sessions (
        id TEXT PRIMARY KEY NOT NULL,
        updated_at TEXT NOT NULL DEFAULT '',
        deleted_at TEXT
      );
      INSERT INTO sessions (id) VALUES ('session-1');`,
    );
    mocks.db.exec(
      readFileSync(
        resolve(
          process.cwd(),
          "../../crates/db-app/migrations/20261113120000_note_types.sql",
        ),
        "utf8",
      ),
    );
  });

  afterEach(() => {
    mocks.db.close();
  });

  it("returns the existing row instead of creating a duplicate name under the same parent", async () => {
    const aula = await createNoteType({ name: "Aula", parentId: null });
    await expect(
      createNoteType({ name: "  aula ", parentId: null }),
    ).resolves.toEqual(aula);

    const daily = await createNoteType({ name: "Daily", parentId: aula.id });
    await expect(
      createNoteType({ name: "DAILY", parentId: aula.id }),
    ).resolves.toEqual(daily);
    const topLevelDaily = await createNoteType({
      name: "Daily",
      parentId: null,
    });

    expect(topLevelDaily.id).not.toBe(daily.id);
    expect((await listNoteTypes()).map((type) => type.name)).toEqual([
      "Aula",
      "Daily",
      "Daily",
    ]);
  });

  it("only stores a subtype that belongs to the chosen type and clears it with the type", async () => {
    const aula = await createNoteType({ name: "Aula", parentId: null });
    const ferreri = await createNoteType({ name: "Ferreri", parentId: null });
    const stats = await createNoteType({
      name: "Estatística e probabilidade",
      parentId: aula.id,
    });

    await expect(
      setSessionNoteType("session-1", {
        typeId: ferreri.id,
        subtypeId: stats.id,
      }),
    ).rejects.toThrow();
    await setSessionNoteType("session-1", {
      typeId: aula.id,
      subtypeId: stats.id,
    });
    await expect(getSessionNoteType("session-1")).resolves.toEqual({
      typeId: aula.id,
      subtypeId: stats.id,
    });

    await setSessionNoteType("session-1", {
      typeId: null,
      subtypeId: stats.id,
    });
    expect(
      mocks.db
        .prepare(
          "SELECT note_type_id, note_subtype_id FROM sessions WHERE id = 'session-1'",
        )
        .get(),
    ).toEqual({ note_type_id: "", note_subtype_id: "" });
  });

  it("deleting a type hides its subtypes and makes notes of that type read as none", async () => {
    const aula = await createNoteType({ name: "Aula", parentId: null });
    const stats = await createNoteType({ name: "Stats", parentId: aula.id });
    const ferreri = await createNoteType({ name: "Ferreri", parentId: null });
    await setSessionNoteType("session-1", {
      typeId: aula.id,
      subtypeId: stats.id,
    });

    await deleteNoteType(aula.id);

    expect(await listNoteTypes()).toEqual([
      { id: ferreri.id, parentId: null, name: "Ferreri", sortOrder: 1 },
    ]);
    await expect(getSessionNoteType("session-1")).resolves.toEqual({
      typeId: null,
      subtypeId: null,
    });
  });
});
