import { describe, expect, test, vi } from "vitest";

import { getSessionResourcePath } from "./resource-path";

vi.mock("@tauri-apps/api/path", () => ({
  sep: vi.fn().mockReturnValue("/"),
}));

describe("getSessionResourcePath", () => {
  test("builds the resource directory for a session", () => {
    expect(getSessionResourcePath("/data/librelog", "session-123")).toBe(
      "/data/librelog/sessions/session-123",
    );
  });
});
