import { describe, expect, it } from "vitest";

import type { UserTemplate } from "./queries";
import { DEFAULT_TEMPLATE_ICON } from "./template-icon";
import { AUTO_TEMPLATE_ID, resolveSelectedTemplateId } from "./utils";

const userTemplate: UserTemplate = {
  id: "template-1",
  title: "Standup",
  description: "",
  pinned: false,
  icon: DEFAULT_TEMPLATE_ICON,
  sections: [],
};

describe("resolveSelectedTemplateId", () => {
  it.each([
    [
      "falls back to Auto when there are no local templates",
      { selectedMineId: null, userTemplates: [] },
      AUTO_TEMPLATE_ID,
    ],
    [
      "selects the first local template when there is no explicit selection",
      { selectedMineId: null, userTemplates: [userTemplate] },
      "template-1",
    ],
    [
      "preserves an explicit Auto selection when local templates exist",
      { selectedMineId: AUTO_TEMPLATE_ID, userTemplates: [userTemplate] },
      AUTO_TEMPLATE_ID,
    ],
    [
      "replaces a deleted selection with the first local template",
      { selectedMineId: "deleted", userTemplates: [userTemplate] },
      "template-1",
    ],
  ])("%s", (_name, input, expected) => {
    expect(resolveSelectedTemplateId(input)).toBe(expected);
  });
});
