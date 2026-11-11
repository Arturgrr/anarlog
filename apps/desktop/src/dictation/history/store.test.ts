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
  settings: {} as Record<string, unknown>,
  keepHistoryAudio: vi.fn(),
  deleteHistoryAudio: vi.fn(),
  pruneHistoryAudio: vi.fn(),
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
}));

vi.mock("~/settings/queries", () => ({
  getStoredSettingValues: async () => ({
    values: mocks.settings,
    hasValues: new Set(Object.keys(mocks.settings)),
  }),
  useStoredSettingValues: vi.fn(),
}));

vi.mock("@anlg/plugin-dictation", () => ({
  commands: {
    keepHistoryAudio: mocks.keepHistoryAudio,
    deleteHistoryAudio: mocks.deleteHistoryAudio,
    pruneHistoryAudio: mocks.pruneHistoryAudio,
  },
}));

import {
  latestDictation,
  purgeExpiredDictations,
  recordDictation,
  replaceDictationText,
  restoreDictationVersion,
} from "./store";

const DAY_MS = 24 * 60 * 60 * 1000;

function dictation(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    createdAt: new Date().toISOString(),
    durationMs: 1200,
    targetApp: { name: "Notes", id: "com.apple.Notes" },
    provider: "soniqo",
    model: "soniqo-parakeet-batch",
    language: "en",
    rawText: `um ${id}`,
    finalText: `${id}.`,
    inserted: true,
    audioPath: `/tmp/librelog-dictation-${id}.wav`,
    ...overrides,
  };
}

function rows() {
  return mocks.db
    .prepare(
      "SELECT id, raw_text, final_text, model, inserted, audio_path, versions_json FROM dictation_history ORDER BY created_at, id",
    )
    .all() as {
    id: string;
    raw_text: string;
    final_text: string;
    model: string;
    inserted: number;
    audio_path: string | null;
    versions_json: string;
  }[];
}

describe("dictation history store", () => {
  beforeEach(() => {
    mocks.db = new DatabaseSync(":memory:");
    mocks.db.exec(
      readFileSync(
        resolve(
          process.cwd(),
          "../../crates/db-app/migrations/20261111120000_dictation_history.sql",
        ),
        "utf8",
      ),
    );
    mocks.settings = {};
    mocks.keepHistoryAudio.mockImplementation(async (id: string) => ({
      status: "ok",
      data: `${id}.wav`,
    }));
    mocks.deleteHistoryAudio.mockResolvedValue({ status: "ok", data: null });
    mocks.pruneHistoryAudio.mockResolvedValue({ status: "ok", data: null });
  });

  afterEach(() => {
    mocks.db.close();
    vi.clearAllMocks();
  });

  it("records every dictation that produced text, even one that was not inserted", async () => {
    await expect(
      recordDictation(dictation("empty", { rawText: " ", finalText: "" })),
    ).resolves.toEqual({ audioKept: false });
    await recordDictation(dictation("failed", { inserted: false }));

    expect(rows()).toMatchObject([
      { id: "failed", final_text: "failed.", inserted: 0, audio_path: null },
    ]);
    await expect(latestDictation()).resolves.toEqual({
      id: "failed",
      text: "failed.",
    });
  });

  it("moves the audio only while keep-audio is on, and says when the caller must not discard it", async () => {
    mocks.settings = { dictation_history_keep_audio: true };
    await expect(recordDictation(dictation("kept"))).resolves.toEqual({
      audioKept: true,
    });
    mocks.keepHistoryAudio.mockResolvedValueOnce({
      status: "error",
      error: "unknown voice recording",
    });
    await expect(recordDictation(dictation("refused"))).resolves.toEqual({
      audioKept: false,
    });

    expect(rows().map((row) => [row.id, row.audio_path])).toEqual([
      ["kept", "kept.wav"],
      ["refused", null],
    ]);
  });

  it("purges expired dictations and their audio, but expires nothing while history is off", async () => {
    mocks.settings = { dictation_history_keep_audio: true };
    const old = new Date(Date.now() - 2 * DAY_MS).toISOString();
    await recordDictation(dictation("old", { createdAt: old }));
    await recordDictation(dictation("new"));

    mocks.settings.dictation_history_retention = "day";
    await purgeExpiredDictations();
    expect(rows().map((row) => row.id)).toEqual(["new"]);
    expect(mocks.pruneHistoryAudio).toHaveBeenLastCalledWith(["new.wav"]);

    mocks.settings.dictation_history_retention = "off";
    await expect(recordDictation(dictation("ignored"))).resolves.toEqual({
      audioKept: false,
    });
    mocks.db
      .prepare("UPDATE dictation_history SET created_at = ?")
      .run(new Date(0).toISOString());
    await purgeExpiredDictations();
    expect(rows().map((row) => row.id)).toEqual(["new"]);
    await expect(latestDictation()).resolves.toBeNull();
  });

  it("restores a version with its own texts and model, and keeps only the five newest", async () => {
    await recordDictation(dictation("entry"));
    const again = (index: number) =>
      replaceDictationText("entry", {
        text: `take ${index}`,
        provider: "soniqo",
        model: `model-${index}`,
        language: "en",
      });
    const versions = () =>
      (JSON.parse(rows()[0].versions_json) as { model: string }[]).map(
        (version) => version.model,
      );

    await again(1);
    await restoreDictationVersion("entry", 0);
    expect(rows()[0]).toMatchObject({
      raw_text: "um entry",
      final_text: "entry.",
      model: "soniqo-parakeet-batch",
    });
    expect(versions()).toEqual(["model-1"]);

    for (const index of [2, 3, 4, 5, 6]) await again(index);
    expect(rows()[0]).toMatchObject({
      raw_text: "take 6",
      final_text: "take 6",
      model: "model-6",
    });
    expect(versions()).toEqual([
      "model-5",
      "model-4",
      "model-3",
      "model-2",
      "soniqo-parakeet-batch",
    ]);
  });
});
