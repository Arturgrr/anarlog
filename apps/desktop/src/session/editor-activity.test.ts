import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  flushDatabaseWrites: vi.fn<() => Promise<void>>(),
}));

vi.mock("~/db/write-queue", () => ({
  flushDatabaseWrites: mocks.flushDatabaseWrites,
}));

import {
  flushCanonicalSessionEditorChanges,
  registerCanonicalSessionEditor,
  unregisterCanonicalSessionEditor,
} from "./editor-activity";

describe("canonical session editor activity", () => {
  it("forces every mounted editor change before draining database writes", async () => {
    const firstView = { hasFocus: () => true } as never;
    const secondView = { hasFocus: () => false } as never;
    const firstFlush = vi.fn();
    const secondFlush = vi.fn();
    registerCanonicalSessionEditor("session-1", firstView, firstFlush);
    registerCanonicalSessionEditor("session-1", secondView, secondFlush);
    mocks.flushDatabaseWrites.mockImplementationOnce(async () => {
      expect(firstFlush).toHaveBeenCalledOnce();
      expect(secondFlush).toHaveBeenCalledOnce();
    });

    await flushCanonicalSessionEditorChanges("session-1");

    expect(mocks.flushDatabaseWrites).toHaveBeenCalledWith([
      "session:session-1",
    ]);
    unregisterCanonicalSessionEditor("session-1", firstView);
    unregisterCanonicalSessionEditor("session-1", secondView);
  });
});
