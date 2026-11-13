import { executeTransaction, liveQueryClient, useLiveQuery } from "~/db";
import { enqueueDatabaseWrite } from "~/db/write-queue";

export type NoteType = {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
};

export type NoteTypeSelection = {
  typeId: string | null;
  subtypeId: string | null;
};

type NoteTypeRow = {
  id: string;
  parent_id: string;
  name: string;
  sort_order: number;
};

type SessionNoteTypeRow = { type_id: string; subtype_id: string };

const CATALOG_WRITES = "note-types";

const NOTE_TYPES_SQL = `
  SELECT id, parent_id, name, sort_order
  FROM note_types
  WHERE deleted_at IS NULL
    AND (
      parent_id = ''
      OR parent_id IN (
        SELECT id FROM note_types WHERE parent_id = '' AND deleted_at IS NULL
      )
    )
  ORDER BY sort_order, created_at, id
`;

const SESSION_NOTE_TYPE_SQL = `
  SELECT
    COALESCE(type_row.id, '') AS type_id,
    COALESCE(subtype_row.id, '') AS subtype_id
  FROM sessions
  LEFT JOIN note_types AS type_row
    ON type_row.id = sessions.note_type_id
    AND type_row.parent_id = ''
    AND type_row.deleted_at IS NULL
  LEFT JOIN note_types AS subtype_row
    ON type_row.id IS NOT NULL
    AND subtype_row.id = sessions.note_subtype_id
    AND subtype_row.parent_id = type_row.id
    AND subtype_row.deleted_at IS NULL
  WHERE sessions.id = ?
  LIMIT 1
`;

const EMPTY_SELECTION: NoteTypeSelection = { typeId: null, subtypeId: null };

function toNoteType(row: NoteTypeRow): NoteType {
  return {
    id: row.id,
    parentId: row.parent_id || null,
    name: row.name,
    sortOrder: Number(row.sort_order),
  };
}

function toSelection(rows: SessionNoteTypeRow[]): NoteTypeSelection {
  const row = rows[0];
  if (!row?.type_id) return EMPTY_SELECTION;
  return { typeId: row.type_id, subtypeId: row.subtype_id || null };
}

function nameKey(name: string) {
  return name.trim().toLocaleLowerCase();
}

function requireName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("note_type_name_required");
  return trimmed;
}

async function liveRow(id: string): Promise<NoteTypeRow | undefined> {
  const rows = await liveQueryClient.execute<NoteTypeRow>(
    `SELECT id, parent_id, name, sort_order FROM note_types
     WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id],
  );
  return rows[0];
}

async function liveSiblings(parentId: string): Promise<NoteTypeRow[]> {
  return liveQueryClient.execute<NoteTypeRow>(
    `SELECT id, parent_id, name, sort_order FROM note_types
     WHERE parent_id = ? AND deleted_at IS NULL
     ORDER BY sort_order, created_at, id`,
    [parentId],
  );
}

export function useNoteTypes(): NoteType[] {
  const { data = [] } = useLiveQuery<NoteTypeRow, NoteType[]>({
    sql: NOTE_TYPES_SQL,
    params: [],
    mapRows: (rows) => rows.map(toNoteType),
  });
  return data;
}

export async function listNoteTypes(): Promise<NoteType[]> {
  const rows = await liveQueryClient.execute<NoteTypeRow>(NOTE_TYPES_SQL, []);
  return rows.map(toNoteType);
}

export function createNoteType(input: {
  name: string;
  parentId: string | null;
}): Promise<NoteType> {
  return enqueueDatabaseWrite(CATALOG_WRITES, async () => {
    const name = requireName(input.name);
    const parentId = input.parentId ?? "";
    if (parentId) {
      const parent = await liveRow(parentId);
      if (!parent || parent.parent_id) {
        throw new Error("note_type_parent_not_found");
      }
    }

    const siblings = await liveSiblings(parentId);
    const existing = siblings.find(
      (row) => nameKey(row.name) === nameKey(name),
    );
    if (existing) return toNoteType(existing);

    const now = new Date().toISOString();
    const row: NoteTypeRow = {
      id: crypto.randomUUID(),
      parent_id: parentId,
      name,
      sort_order:
        siblings.reduce(
          (max, row) => Math.max(max, Number(row.sort_order)),
          -1,
        ) + 1,
    };
    await executeTransaction([
      {
        sql: `INSERT INTO note_types (id, parent_id, name, sort_order, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        params: [row.id, row.parent_id, row.name, row.sort_order, now, now],
      },
    ]);
    return toNoteType(row);
  });
}

export function renameNoteType(id: string, name: string): Promise<void> {
  return enqueueDatabaseWrite(CATALOG_WRITES, async () => {
    const nextName = requireName(name);
    const row = await liveRow(id);
    if (!row) throw new Error("note_type_not_found");
    if (row.name === nextName) return;

    const siblings = await liveSiblings(row.parent_id);
    if (
      siblings.some(
        (sibling) =>
          sibling.id !== id && nameKey(sibling.name) === nameKey(nextName),
      )
    ) {
      throw new Error("note_type_name_taken");
    }

    await executeTransaction([
      {
        sql: `UPDATE note_types SET name = ?, updated_at = ?
              WHERE id = ? AND deleted_at IS NULL`,
        params: [nextName, new Date().toISOString(), id],
      },
    ]);
  });
}

export function deleteNoteType(id: string): Promise<void> {
  return enqueueDatabaseWrite(CATALOG_WRITES, async () => {
    const now = new Date().toISOString();
    await executeTransaction([
      {
        sql: `UPDATE note_types SET deleted_at = ?, updated_at = ?
              WHERE (id = ? OR parent_id = ?) AND deleted_at IS NULL`,
        params: [now, now, id, id],
      },
    ]);
  });
}

export function useSessionNoteType(sessionId: string): NoteTypeSelection {
  const { data = EMPTY_SELECTION } = useLiveQuery<
    SessionNoteTypeRow,
    NoteTypeSelection
  >({
    sql: SESSION_NOTE_TYPE_SQL,
    params: [sessionId],
    enabled: sessionId.length > 0,
    mapRows: toSelection,
  });
  return data;
}

export async function getSessionNoteType(
  sessionId: string,
): Promise<NoteTypeSelection> {
  const rows = await liveQueryClient.execute<SessionNoteTypeRow>(
    SESSION_NOTE_TYPE_SQL,
    [sessionId],
  );
  return toSelection(rows);
}

export function setSessionNoteType(
  sessionId: string,
  selection: NoteTypeSelection,
): Promise<void> {
  return enqueueDatabaseWrite(`session:${sessionId}`, async () => {
    const typeId = selection.typeId ?? "";
    const subtypeId = typeId ? (selection.subtypeId ?? "") : "";
    if (typeId) {
      const type = await liveRow(typeId);
      if (!type || type.parent_id) throw new Error("note_type_not_found");
    }
    if (subtypeId) {
      const subtype = await liveRow(subtypeId);
      if (!subtype || subtype.parent_id !== typeId) {
        throw new Error("note_subtype_not_in_type");
      }
    }

    await executeTransaction([
      {
        sql: `UPDATE sessions
              SET note_type_id = ?, note_subtype_id = ?, updated_at = ?
              WHERE id = ? AND deleted_at IS NULL`,
        params: [typeId, subtypeId, new Date().toISOString(), sessionId],
      },
    ]);
  });
}
