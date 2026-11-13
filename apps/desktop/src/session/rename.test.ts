import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  title: "Old title",
  bodies: new Map<string, string>(),
  pending: null as { noteId: string; body: string } | null,
}));

const heading = (text: string) =>
  JSON.stringify({
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text }],
      },
      { type: "paragraph", content: [{ type: "text", text: "Body" }] },
    ],
  });

vi.mock("~/session/content-queries", () => ({
  loadSessionContentSnapshot: async () => {
    await Promise.resolve();
    return {
      title: db.title,
      enhancedNotes: [...db.bodies].map(([id, content]) => ({
        id,
        content,
        contentFormat: "prosemirror_json",
      })),
    };
  },
}));

vi.mock("~/services/enhancer/storage", () => ({
  loadPendingAutoEnhanceNote: async () => db.pending,
}));

vi.mock("@anlg/plugin-template", () => ({
  commands: {
    saveGeneratedTitle: async (request: {
      current_title: string;
      next_title: string;
      documents: Array<{ id: string; current_body: string; next_body: string }>;
    }) => {
      await Promise.resolve();
      if (
        request.current_title !== db.title ||
        request.documents.some(
          (document) => db.bodies.get(document.id) !== document.current_body,
        )
      ) {
        return { status: "error", error: "row count mismatch" };
      }
      db.title = request.next_title;
      for (const document of request.documents) {
        db.bodies.set(document.id, document.next_body);
      }
      return { status: "ok", data: null };
    },
  },
}));

vi.mock("~/db", () => ({
  executeTransaction: async (
    statements: Array<{ sql: string; params: unknown[] }>,
  ) => {
    db.title = statements[0].params[0] as string;
  },
}));

import { renameSession } from "./rename";

describe("renameSession", () => {
  beforeEach(() => {
    db.title = "Old title";
    db.bodies = new Map([["summary-1", heading("Old title")]]);
    db.pending = null;
  });

  it("stores the last of two concurrent renames instead of failing the later one", async () => {
    await Promise.all([
      renameSession("session-1", "First"),
      renameSession("session-1", "Second"),
    ]);

    expect(db.title).toBe("Second");
    expect(db.bodies.get("summary-1")).toBe(heading("Second"));
  });

  it("leaves a summary awaiting regeneration untouched so its result can still be saved", async () => {
    db.pending = { noteId: "summary-1", body: heading("Old title") };

    await renameSession("session-1", "New title");

    expect(db.title).toBe("New title");
    expect(db.bodies.get("summary-1")).toBe(heading("Old title"));
  });
});
