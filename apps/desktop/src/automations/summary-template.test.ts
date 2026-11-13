import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStoredSettingValues: vi.fn(),
  getSessionNoteType: vi.fn(),
  getTemplateById: vi.fn(),
}));

vi.mock("~/settings/queries", () => ({
  getStoredSettingValues: mocks.getStoredSettingValues,
}));

vi.mock("~/note-types/queries", () => ({
  getSessionNoteType: mocks.getSessionNoteType,
}));

vi.mock("~/templates/queries", () => ({
  getTemplateById: mocks.getTemplateById,
}));

import { getWorkflowSummaryTemplateId } from "./summary-template";

function templateWorkflow(
  id: string,
  templateId: string,
  conditions: { noteTypeId: string; noteSubtypeId?: string } | null,
) {
  return {
    id,
    enabled: true,
    trigger: "meeting_completed",
    conditions,
    steps: [{ id: `${id}-step`, type: "summary_template", templateId }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStoredSettingValues.mockResolvedValue({
    values: {
      automation_workflows: JSON.stringify([
        templateWorkflow("every", "t-every", null),
        templateWorkflow("subtype", "t-daily", {
          noteTypeId: "ferreri",
          noteSubtypeId: "daily",
        }),
        templateWorkflow("type", "t-ferreri", { noteTypeId: "ferreri" }),
        templateWorkflow("other-subtype", "t-weekly", {
          noteTypeId: "ferreri",
          noteSubtypeId: "weekly",
        }),
      ]),
    },
  });
  mocks.getTemplateById.mockImplementation(async (id: string) => ({ id }));
});

describe("getWorkflowSummaryTemplateId", () => {
  it.each([
    [{ typeId: "ferreri", subtypeId: "daily" }, "t-daily"],
    [{ typeId: "ferreri", subtypeId: null }, "t-ferreri"],
    [{ typeId: "aula", subtypeId: null }, "t-every"],
  ])("prefers the most specific matching workflow for %j", async (note, id) => {
    mocks.getSessionNoteType.mockResolvedValue(note);

    await expect(getWorkflowSummaryTemplateId("session-1")).resolves.toBe(id);
  });

  it("falls through a deleted template to the next matching workflow", async () => {
    mocks.getSessionNoteType.mockResolvedValue({
      typeId: "ferreri",
      subtypeId: "daily",
    });
    mocks.getTemplateById.mockImplementation(async (id: string) =>
      id === "t-daily" ? null : { id },
    );

    await expect(getWorkflowSummaryTemplateId("session-1")).resolves.toBe(
      "t-ferreri",
    );
  });
});
