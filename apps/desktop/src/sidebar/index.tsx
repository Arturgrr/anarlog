import { type ReactNode } from "react";

import { cn } from "@anlg/utils";

import { AutomationsNav } from "./automations";
import { ContactsNav } from "./contacts";
import { FolderMaterialsPanel } from "./folder-materials";
import { FoldersNav } from "./folders";
import { SettingsNav } from "./settings";
import { TemplatesNav } from "./templates";
import { TimelineView } from "./timeline";
import { hasOwnSidebarHeaderTab } from "./use-custom-sidebar";

import { usesTitleBarSidebarActions } from "~/shared/hooks/useWindowControlsGutter";
import { useTabs } from "~/store/zustand/tabs";

export function LeftSidebar({
  folderFilter = null,
  timelineHeader,
}: {
  folderFilter?: string | null;
  timelineHeader?: ReactNode;
} = {}) {
  const currentTab = useTabs((state) => state.currentTab);

  const isSettingsMode = currentTab?.type === "settings";
  const isContactsMode = currentTab?.type === "contacts";
  const isTemplatesMode = currentTab?.type === "templates";
  const isAutomationsMode = currentTab?.type === "automations";
  const isFoldersMode = currentTab?.type === "folders";
  const isSpecialMode =
    isSettingsMode ||
    isContactsMode ||
    isTemplatesMode ||
    isAutomationsMode ||
    isFoldersMode;
  const isTimelineSidebarLayout = !isSpecialMode;
  // Navs with their own CustomSidebarHeader fill the chrome row themselves; a
  // top padding here would push the header out of it (and overflow-hidden
  // would clip a pulled-up header).
  const needsChromeRowGutter =
    isSpecialMode && !hasOwnSidebarHeaderTab(currentTab);
  return (
    <div
      className={cn([
        "flex h-full w-full shrink-0 flex-col gap-1 overflow-hidden",
        needsChromeRowGutter ? "pt-11" : "pt-0",
        !isTimelineSidebarLayout && "pr-1",
      ])}
    >
      <div className="flex flex-1 flex-col gap-1 overflow-hidden">
        {isTimelineSidebarLayout ? timelineHeader : null}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {isSettingsMode ? (
            <SettingsNav />
          ) : isContactsMode ? (
            <ContactsNav />
          ) : isTemplatesMode ? (
            <TemplatesNav />
          ) : isAutomationsMode ? (
            <AutomationsNav />
          ) : isFoldersMode ? (
            <FoldersNav />
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              {folderFilter ? (
                <FolderMaterialsPanel folderPath={folderFilter} />
              ) : null}
              <div className="relative min-h-0 flex-1">
                <TimelineView
                  folderFilter={folderFilter}
                  topChromeInset={
                    isTimelineSidebarLayout &&
                    !timelineHeader &&
                    !usesTitleBarSidebarActions()
                  }
                  topChipsOverlapHeader={
                    isTimelineSidebarLayout && !!timelineHeader
                  }
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
