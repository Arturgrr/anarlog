import { TemplateView } from "./template-body";

import { StandardContentWrapper } from "~/shared/main";
import { type Tab } from "~/store/zustand/tabs";

export {
  useCreateTemplate,
  useUserTemplate,
  useUserTemplates,
} from "./queries";
export type { UserTemplate, UserTemplateDraft } from "./queries";
export { DEFAULT_TEMPLATE_ICON, TemplateIconGlyph } from "./template-icon";
export type { TemplateIcon } from "./template-icon";
export { useOpenTemplatesTab } from "./use-open-templates-tab";
export { TemplatesSidebarContent } from "./template-sidebar";

export function TabContentTemplate({
  tab,
}: {
  tab: Extract<Tab, { type: "templates" }>;
}) {
  return (
    <StandardContentWrapper>
      <TemplateView tab={tab} />
    </StandardContentWrapper>
  );
}
