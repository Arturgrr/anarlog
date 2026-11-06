import { describe, expect, it } from "vitest";

import { sessionSearchTimestamp } from "./utils";

describe("sessionSearchTimestamp", () => {
  it("uses the session created_at", () => {
    expect(sessionSearchTimestamp("2025-01-01T00:00:00.000Z")).toBe(
      Date.parse("2025-01-01T00:00:00.000Z"),
    );
  });

  it("returns 0 for a blank created_at", () => {
    expect(sessionSearchTimestamp("")).toBe(0);
  });
});
