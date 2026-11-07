import { useLingui } from "@lingui/react/macro";
import { useCallback } from "react";

import {
  useCreateTemplate,
  useDeleteTemplate,
  useToggleTemplateFavorite,
  useUserTemplates,
  type UserTemplate,
} from "./queries";

import { type Tab, useTabs } from "~/store/zustand/tabs";

export const AUTO_TEMPLATE_ID = "__auto__";

export function resolveSelectedTemplateId({
  selectedMineId,
  userTemplates,
}: {
  selectedMineId: string | null | undefined;
  userTemplates: UserTemplate[];
}) {
  if (selectedMineId === AUTO_TEMPLATE_ID) {
    return AUTO_TEMPLATE_ID;
  }

  return (
    userTemplates.find((template) => template.id === selectedMineId)?.id ??
    userTemplates[0]?.id ??
    AUTO_TEMPLATE_ID
  );
}

export function useTemplateTab(tab: Extract<Tab, { type: "templates" }>) {
  const { t } = useLingui();
  const updateTabState = useTabs((state) => state.updateTemplatesTabState);
  const userTemplates = useUserTemplates();
  const createTemplate = useCreateTemplate();
  const deleteTemplate = useDeleteTemplate();
  const toggleTemplateFavorite = useToggleTemplateFavorite();
  const selectedMineId = resolveSelectedTemplateId({
    selectedMineId: tab.state.selectedMineId,
    userTemplates,
  });

  const setSelectedMineId = useCallback(
    (id: string | null) => {
      updateTabState(tab, { ...tab.state, selectedMineId: id });
    },
    [updateTabState, tab],
  );

  const createDefaultTemplate = useCallback(async () => {
    const id = await createTemplate({
      title: t`New Template`,
      description: "",
      sections: [],
    });

    if (id) {
      setSelectedMineId(id);
    }

    return id;
  }, [createTemplate, setSelectedMineId, t]);

  return {
    userTemplates,
    selectedMineId,
    setSelectedMineId,
    createTemplate,
    createDefaultTemplate,
    deleteTemplate,
    toggleTemplateFavorite,
  };
}
