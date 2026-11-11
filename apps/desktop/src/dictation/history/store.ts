import { t } from "@lingui/core/macro";

import { commands as dictation } from "@anlg/plugin-dictation";

import { executeTransaction, liveQueryClient } from "~/db";
import { enqueueDatabaseWrite } from "~/db/write-queue";
import { getStoredSettingValues } from "~/settings/queries";
import { resolveConfigValue } from "~/shared/config";

export const DICTATION_HISTORY_RETENTIONS = [
  "off",
  "day",
  "week",
  "month",
  "forever",
] as const;

export type DictationHistoryRetention =
  (typeof DICTATION_HISTORY_RETENTIONS)[number];

export type DictationVersion = {
  rawText: string;
  finalText: string;
  provider: string | null;
  model: string | null;
  language: string | null;
  createdAt: string;
};

export type DictationEntry = {
  id: string;
  createdAt: string;
  durationMs: number;
  targetAppName: string | null;
  targetAppId: string | null;
  provider: string | null;
  model: string | null;
  language: string | null;
  rawText: string;
  finalText: string;
  inserted: boolean;
  audioPath: string | null;
  transcribedAt: string | null;
  versions: DictationVersion[];
};

export type DictationRow = {
  id: string;
  created_at: string;
  duration_ms: number;
  target_app_name: string | null;
  target_app_id: string | null;
  provider: string | null;
  model: string | null;
  language: string | null;
  raw_text: string;
  final_text: string;
  inserted: number | boolean;
  audio_path: string | null;
  transcribed_at: string | null;
  versions_json: string;
};

export const DICTATION_COLUMNS = `id, created_at, duration_ms, target_app_name,
  target_app_id, provider, model, language, raw_text, final_text, inserted,
  audio_path, transcribed_at, versions_json`;

// Every history write, and the reads that must see them, run in this order.
const WRITES = "dictation-history";
const MAX_VERSIONS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS: Partial<Record<DictationHistoryRetention, number>> = {
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
};
const AUDIO_FILE_NAME = /^[A-Za-z0-9-]{1,64}\.wav$/u;

export function normalizeRetention(value: unknown): DictationHistoryRetention {
  return (
    DICTATION_HISTORY_RETENTIONS.find((option) => option === value) ?? "week"
  );
}

/** Entries created before this are expired; null keeps every entry. */
function retentionCutoff(retention: DictationHistoryRetention) {
  const age = RETENTION_MS[retention];
  return age === undefined ? null : new Date(Date.now() - age).toISOString();
}

async function loadSettings() {
  const stored = await getStoredSettingValues();
  return {
    retention: normalizeRetention(
      resolveConfigValue("dictation_history_retention", stored),
    ),
    keepAudio: resolveConfigValue("dictation_history_keep_audio", stored),
  };
}

function unwrap<T>(
  result: { status: "ok"; data: T } | { status: "error"; error: string },
): T {
  if (result.status === "error") throw new Error(result.error);
  return result.data;
}

function isoOrNow(value: string) {
  const time = new Date(value).getTime();
  return new Date(Number.isNaN(time) ? Date.now() : time).toISOString();
}

/**
 * Saves a dictation that produced text, unless history is off. With
 * keep-audio on, the recorder's temporary WAV moves into the history; then
 * `audioKept` is true and the caller must not discard it. Rejects only when
 * nothing was saved and the temporary WAV is untouched.
 */
export function recordDictation(entry: {
  id: string;
  createdAt: string;
  durationMs: number;
  targetApp: { name: string; id: string | null } | null;
  provider: string | null;
  model: string | null;
  language: string | null;
  rawText: string;
  finalText: string;
  inserted: boolean;
  audioPath: string | null;
}): Promise<{ audioKept: boolean }> {
  return enqueueDatabaseWrite(WRITES, async () => {
    if (!entry.rawText.trim() && !entry.finalText.trim()) {
      return { audioKept: false };
    }
    const { retention, keepAudio } = await loadSettings();
    if (retention === "off") return { audioKept: false };

    await executeTransaction([
      {
        sql: `INSERT INTO dictation_history (
          id, created_at, duration_ms, target_app_name, target_app_id,
          provider, model, language, raw_text, final_text, inserted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          entry.id,
          isoOrNow(entry.createdAt),
          Number.isFinite(entry.durationMs)
            ? Math.max(0, Math.round(entry.durationMs))
            : 0,
          entry.targetApp?.name ?? null,
          entry.targetApp?.id ?? null,
          entry.provider,
          entry.model,
          entry.language,
          entry.rawText,
          entry.finalText,
          entry.inserted ? 1 : 0,
        ],
      },
    ]);
    if (!keepAudio || !entry.audioPath) return { audioKept: false };

    let kept: string;
    try {
      kept = unwrap(
        await dictation.keepHistoryAudio(entry.id, entry.audioPath),
      );
    } catch (error) {
      console.error("[dictation-history] audio was not kept", error);
      return { audioKept: false };
    }
    try {
      await executeTransaction([
        {
          sql: "UPDATE dictation_history SET audio_path = ? WHERE id = ?",
          params: [kept, entry.id],
        },
      ]);
    } catch (error) {
      // The next purge deletes the unlinked file.
      console.error("[dictation-history] audio was not linked", error);
    }
    return { audioKept: true };
  });
}

/** The newest dictation's current text, while history is on. */
export function latestDictation(): Promise<{
  id: string;
  text: string;
} | null> {
  return enqueueDatabaseWrite(WRITES, async () => {
    const { retention } = await loadSettings();
    if (retention === "off") return null;
    const [row] = await liveQueryClient.execute<{
      id: string;
      raw_text: string;
      final_text: string;
    }>(
      `SELECT id, raw_text, final_text FROM dictation_history
       WHERE created_at >= ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [retentionCutoff(retention) ?? ""],
    );
    if (!row) return null;
    return {
      id: row.id,
      text: row.final_text.trim() ? row.final_text : row.raw_text,
    };
  });
}

/**
 * Deletes entries older than the retention allows, with their audio, and
 * any kept audio no entry refers to. Off and Forever expire nothing.
 */
export function purgeExpiredDictations(): Promise<void> {
  return enqueueDatabaseWrite(WRITES, async () => {
    const cutoff = retentionCutoff((await loadSettings()).retention);
    if (cutoff) {
      await executeTransaction([
        {
          sql: "DELETE FROM dictation_history WHERE created_at < ?",
          params: [cutoff],
        },
      ]);
    }
    await pruneAudio();
  });
}

export function deleteDictation(id: string): Promise<void> {
  return enqueueDatabaseWrite(WRITES, async () => {
    const [row] = await liveQueryClient.execute<{ audio_path: string | null }>(
      "SELECT audio_path FROM dictation_history WHERE id = ?",
      [id],
    );
    if (row?.audio_path && AUDIO_FILE_NAME.test(row.audio_path)) {
      unwrap(await dictation.deleteHistoryAudio([row.audio_path]));
    }
    await executeTransaction([
      { sql: "DELETE FROM dictation_history WHERE id = ?", params: [id] },
    ]);
  });
}

export function clearDictations(): Promise<void> {
  return enqueueDatabaseWrite(WRITES, async () => {
    unwrap(await dictation.pruneHistoryAudio([]));
    await executeTransaction([
      { sql: "DELETE FROM dictation_history", params: [] },
    ]);
  });
}

/**
 * Makes `transcript` the entry's text; the text it replaces becomes the
 * newest version.
 */
export function replaceDictationText(
  id: string,
  transcript: {
    text: string;
    provider: string | null;
    model: string | null;
    language: string | null;
  },
): Promise<void> {
  return updateTexts(id, (entry) => {
    const versions = [current(entry), ...entry.versions];
    return adopt(
      { ...entry, versions },
      {
        rawText: transcript.text,
        finalText: transcript.text,
        provider: transcript.provider,
        model: transcript.model,
        language: transcript.language,
        createdAt: new Date().toISOString(),
      },
    );
  });
}

/** Swaps version `index` with the entry's current text. */
export function restoreDictationVersion(
  id: string,
  index: number,
): Promise<void> {
  return updateTexts(id, (entry) => {
    const version = entry.versions[index];
    if (!version) throw new Error(t`This version is no longer available.`);
    const versions = [
      current(entry),
      ...entry.versions.filter((_, position) => position !== index),
    ];
    return adopt({ ...entry, versions }, version);
  });
}

function updateTexts(
  id: string,
  update: (entry: DictationEntry) => DictationEntry,
): Promise<void> {
  return enqueueDatabaseWrite(WRITES, async () => {
    const [row] = await liveQueryClient.execute<DictationRow>(
      `SELECT ${DICTATION_COLUMNS} FROM dictation_history WHERE id = ?`,
      [id],
    );
    if (!row) {
      throw new Error(t`This dictation is no longer in your history.`);
    }
    const next = update(mapDictationRow(row));
    await executeTransaction([
      {
        sql: `UPDATE dictation_history SET
          raw_text = ?, final_text = ?, provider = ?, model = ?, language = ?,
          transcribed_at = ?, versions_json = ?
        WHERE id = ?`,
        params: [
          next.rawText,
          next.finalText,
          next.provider,
          next.model,
          next.language,
          next.transcribedAt,
          JSON.stringify(
            next.versions.slice(0, MAX_VERSIONS).map((version) => ({
              raw_text: version.rawText,
              final_text: version.finalText,
              provider: version.provider,
              model: version.model,
              language: version.language,
              created_at: version.createdAt,
            })),
          ),
          id,
        ],
      },
    ]);
  });
}

function current(entry: DictationEntry): DictationVersion {
  return {
    rawText: entry.rawText,
    finalText: entry.finalText,
    provider: entry.provider,
    model: entry.model,
    language: entry.language,
    createdAt: entry.transcribedAt ?? entry.createdAt,
  };
}

function adopt(
  entry: DictationEntry,
  version: DictationVersion,
): DictationEntry {
  return {
    ...entry,
    rawText: version.rawText,
    finalText: version.finalText,
    provider: version.provider,
    model: version.model,
    language: version.language,
    transcribedAt:
      version.createdAt === entry.createdAt ? null : version.createdAt,
  };
}

async function pruneAudio() {
  const rows = await liveQueryClient.execute<{ audio_path: string }>(
    "SELECT audio_path FROM dictation_history WHERE audio_path IS NOT NULL",
  );
  unwrap(
    await dictation.pruneHistoryAudio(
      rows
        .map((row) => row.audio_path)
        .filter((name) => AUDIO_FILE_NAME.test(name)),
    ),
  );
}

export function mapDictationRow(row: DictationRow): DictationEntry {
  return {
    id: row.id,
    createdAt: row.created_at,
    durationMs: Number(row.duration_ms) || 0,
    targetAppName: row.target_app_name,
    targetAppId: row.target_app_id,
    provider: row.provider,
    model: row.model,
    language: row.language,
    rawText: row.raw_text,
    finalText: row.final_text,
    inserted: Boolean(row.inserted),
    audioPath: row.audio_path,
    transcribedAt: row.transcribed_at,
    versions: parseVersions(row.versions_json),
  };
}

function parseVersions(json: string): DictationVersion[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  return parsed.flatMap((value: Record<string, unknown> | null) => {
    const finalText = text(value?.final_text);
    if (finalText === null) return [];
    return [
      {
        rawText: text(value?.raw_text) ?? finalText,
        finalText,
        provider: text(value?.provider),
        model: text(value?.model),
        language: text(value?.language),
        createdAt: text(value?.created_at) ?? "",
      },
    ];
  });
}
