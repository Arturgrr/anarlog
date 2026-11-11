-- Dictations this device made, never synced, indexed or exported.
CREATE TABLE IF NOT EXISTS dictation_history (
 id TEXT PRIMARY KEY NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
 duration_ms INTEGER NOT NULL DEFAULT 0,
 target_app_name TEXT,
 target_app_id TEXT,
 provider TEXT,
 model TEXT,
 language TEXT,
 raw_text TEXT NOT NULL DEFAULT '',
 final_text TEXT NOT NULL DEFAULT '',
 inserted INTEGER NOT NULL DEFAULT 0 CHECK (inserted IN (0, 1)),
 audio_path TEXT,
 transcribed_at TEXT,
 versions_json TEXT NOT NULL DEFAULT '[]'
) STRICT;

CREATE INDEX IF NOT EXISTS idx_dictation_history_created_at
ON dictation_history (created_at DESC, id DESC);
