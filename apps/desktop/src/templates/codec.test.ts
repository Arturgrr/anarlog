import { describe, expect, it } from "vitest";

import {
  assertCanonicalTemplateSections,
  parseStoredTemplateSections,
  parseStoredTemplateTargets,
} from "./codec";

describe("parseStoredTemplateSections", () => {
  it.each([
    [
      "canonical JSON text",
      '[{"title":"Updates","description":"What changed"}]',
      [{ title: "Updates", description: "What changed" }],
    ],
    [
      "legacy string arrays",
      '["Updates","Feedback"]',
      [
        { title: "Updates", description: "" },
        { title: "Feedback", description: "" },
      ],
    ],
    [
      "missing descriptions on stored objects",
      '[{"title":"Updates"}]',
      [{ title: "Updates", description: "" }],
    ],
    [
      "blank draft sections",
      '[{"title":"","description":""},{"title":"","description":"Capture decisions"}]',
      [
        { title: "", description: "" },
        { title: "", description: "Capture decisions" },
      ],
    ],
    ["invalid stored JSON", "{", []],
  ])("normalizes stored sections: %s", (_name, raw, expected) => {
    expect(parseStoredTemplateSections(raw, "template-1")).toEqual(expected);
  });
});

describe("parseStoredTemplateTargets", () => {
  it("normalizes stored targets and rejects invalid JSON", () => {
    expect(parseStoredTemplateTargets('"Manager"', "template-1")).toEqual([
      "Manager",
    ]);
    expect(parseStoredTemplateTargets("{", "template-1")).toBeUndefined();
  });
});

describe("assertCanonicalTemplateSections", () => {
  it("rejects section entries that are not objects", () => {
    expect(() =>
      assertCanonicalTemplateSections(["Manager"], "enhance render"),
    ).toThrow(/enhance render/);
  });

  it("keeps draft rows before saving", () => {
    expect(
      assertCanonicalTemplateSections(
        [
          { title: "", description: "" },
          { title: "", description: "Capture decisions" },
        ],
        "template form",
      ),
    ).toEqual([
      { title: "", description: "" },
      { title: "", description: "Capture decisions" },
    ]);
  });
});
