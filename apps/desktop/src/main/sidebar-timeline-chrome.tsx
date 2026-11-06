import { useLingui } from "@lingui/react/macro";
import { memo, type ReactNode } from "react";

import {
  MagnifyingGlass,
  NotePencil,
  Sidebar,
  SidebarSimple,
} from "@anlg/ui/components/icons";
import { cn } from "@anlg/utils";

import { SidebarNoteFilterMenu } from "~/sidebar/note-filter-menu";
import { useSidebarUpcomingMeetingStatus } from "~/sidebar/timeline/upcoming-meeting";

export const SidebarTimelineChromeWithUpcomingMeeting = memo(
  function SidebarTimelineChromeWithUpcomingMeeting({
    currentSessionId,
    onNewNote,
    onSearch,
    onToggleSidebar,
    sidebarExpanded,
    showSidebarToggle = true,
    showIgnoredTimelineEvents,
  }: {
    currentSessionId?: string;
    onNewNote: () => void;
    onSearch: () => void;
    onToggleSidebar: () => void;
    sidebarExpanded: boolean;
    showSidebarToggle?: boolean;
    showIgnoredTimelineEvents: boolean;
  }) {
    const upcomingMeetingStatus = useSidebarUpcomingMeetingStatus({
      showIgnored: showIgnoredTimelineEvents,
    });
    const hasUpcomingMeeting = upcomingMeetingStatus
      ? !currentSessionId ||
        upcomingMeetingStatus.itemKey !== `session-${currentSessionId}`
      : false;

    return (
      <SidebarTimelineChrome
        hasUpcomingMeeting={hasUpcomingMeeting}
        onNewNote={onNewNote}
        onSearch={onSearch}
        onToggleSidebar={onToggleSidebar}
        sidebarExpanded={sidebarExpanded}
        showSidebarToggle={showSidebarToggle}
      />
    );
  },
);

function SidebarTimelineChrome({
  hasUpcomingMeeting,
  onNewNote,
  onSearch,
  onToggleSidebar,
  sidebarExpanded,
  showSidebarToggle,
}: {
  hasUpcomingMeeting: boolean;
  onNewNote: () => void;
  onSearch: () => void;
  onToggleSidebar: () => void;
  sidebarExpanded: boolean;
  showSidebarToggle: boolean;
}) {
  const { t } = useLingui();
  const collapsedBadge = !sidebarExpanded
    ? hasUpcomingMeeting
      ? "upcomingMeeting"
      : null
    : null;

  return (
    <div data-tauri-drag-region className="flex w-full items-center">
      <div data-tauri-drag-region className="flex items-center gap-0">
        {showSidebarToggle && (
          <LeftSurfaceChromeButton
            ariaLabel={sidebarExpanded ? t`Hide sidebar` : t`Show sidebar`}
            badge={collapsedBadge}
            onClick={onToggleSidebar}
          >
            {sidebarExpanded ? (
              <SidebarSimple size={16} />
            ) : (
              <Sidebar size={16} />
            )}
          </LeftSurfaceChromeButton>
        )}
        {sidebarExpanded ? (
          <SidebarNoteActions onNewNote={onNewNote} onSearch={onSearch} />
        ) : null}
      </div>
    </div>
  );
}

export function SidebarNoteActions({
  onNewNote,
  onSearch,
}: {
  onNewNote: () => void;
  onSearch: () => void;
}) {
  const { t } = useLingui();

  return (
    <>
      <LeftSurfaceChromeButton ariaLabel={t`Search`} onClick={onSearch}>
        <MagnifyingGlass size={15} />
      </LeftSurfaceChromeButton>
      <LeftSurfaceChromeButton ariaLabel={t`New note`} onClick={onNewNote}>
        <NotePencil size={15} />
      </LeftSurfaceChromeButton>
      <SidebarNoteFilterMenu />
    </>
  );
}

export function LeftSurfaceChromeButton({
  ariaLabel,
  badge = null,
  children,
  disabled = false,
  onClick,
}: {
  ariaLabel: string;
  badge?: "upcomingMeeting" | null;
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      data-tauri-drag-region="false"
      disabled={disabled}
      className={cn([
        "pointer-events-auto relative flex size-7 items-center justify-center rounded-md",
        "text-icon-muted hover:bg-hover hover:text-icon active:bg-pressed",
        "focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-[2.5px]",
        "disabled:text-icon-faint disabled:hover:text-icon-faint disabled:hover:bg-transparent",
      ])}
      onClick={onClick}
    >
      {children}
      {badge ? (
        <span
          aria-hidden="true"
          data-testid="collapsed-sidebar-upcoming-meeting-badge"
          className="ring-background bg-foreground pointer-events-none absolute top-1 right-1 size-1.5 rounded-full ring-2"
        />
      ) : null}
    </button>
  );
}
