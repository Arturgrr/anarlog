-- User-managed note type catalog. A row with an empty parent_id is a type;
-- otherwise it is a subtype of that type (one level only). Sessions store the
-- chosen ids; an id that no longer resolves to a live row reads as none.
-- Older builds ignore the new table and columns.
CREATE TABLE IF NOT EXISTS note_types (
  id          TEXT PRIMARY KEY NOT NULL,
  parent_id   TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at  TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_note_types_parent
  ON note_types(parent_id, sort_order);

ALTER TABLE sessions ADD COLUMN note_type_id TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN note_subtype_id TEXT NOT NULL DEFAULT '';
