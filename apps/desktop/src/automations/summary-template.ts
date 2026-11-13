import {
  readAutomationWorkflows,
  workflowSummaryTemplateIds,
} from "./workflows";

import { getSessionNoteType } from "~/note-types/queries";
import { getStoredSettingValues } from "~/settings/queries";
import { getTemplateById } from "~/templates/queries";

export async function getWorkflowSummaryTemplateId(
  sessionId: string,
): Promise<string | undefined> {
  const { values } = await getStoredSettingValues();
  const workflows = readAutomationWorkflows(values);
  if (
    !workflows.some((workflow) =>
      workflow.steps.some((step) => step.type === "summary_template"),
    )
  ) {
    return undefined;
  }

  const templateIds = workflowSummaryTemplateIds(
    workflows,
    await getSessionNoteType(sessionId),
  );
  for (const templateId of templateIds) {
    if (await getTemplateById(templateId)) {
      return templateId;
    }
  }
  return undefined;
}
