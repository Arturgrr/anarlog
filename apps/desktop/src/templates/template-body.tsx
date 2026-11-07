import { useCallback } from "react";

import { TemplateDetailsColumn } from "./details";
import { getTemplateCopyTitle, type UserTemplateDraft } from "./queries";
import { AUTO_TEMPLATE_ID, useTemplateTab } from "./utils";

import { type Tab } from "~/store/zustand/tabs";

export function TemplateView({
  tab,
}: {
  tab: Extract<Tab, { type: "templates" }>;
}) {
  const {
    userTemplates,
    selectedMineId,
    setSelectedMineId,
    createTemplate,
    createDefaultTemplate,
    deleteTemplate,
  } = useTemplateTab(tab);
  const handleDeleteTemplate = useCallback(
    async (id: string) => {
      await deleteTemplate(id);
      setSelectedMineId(null);
    },
    [deleteTemplate, setSelectedMineId],
  );

  const handleCloneTemplate = useCallback(
    async (draft: UserTemplateDraft) => {
      const id = await createTemplate({
        ...draft,
        title: getTemplateCopyTitle(draft.title),
      });
      if (id) setSelectedMineId(id);
    },
    [createTemplate, setSelectedMineId],
  );

  const handleDuplicateTemplate = useCallback(
    async (id: string) => {
      const template = userTemplates.find((t) => t.id === id);
      if (!template) return;
      await handleCloneTemplate({
        title: template.title,
        description: template.description,
        category: template.category,
        icon: template.icon,
        targets: template.targets,
        sections: template.sections,
      });
    },
    [handleCloneTemplate, userTemplates],
  );

  const selectedMineTemplate =
    userTemplates.find((template) => template.id === selectedMineId) ?? null;

  return (
    <div className="h-full">
      <TemplateDetailsColumn
        isAutoSelected={selectedMineId === AUTO_TEMPLATE_ID}
        selectedMineTemplate={selectedMineTemplate}
        handleCreateTemplate={createDefaultTemplate}
        handleDeleteTemplate={handleDeleteTemplate}
        handleDuplicateTemplate={handleDuplicateTemplate}
      />
    </div>
  );
}
