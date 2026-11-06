import { memo, type ReactNode } from "react";

import {
  MagnifyingGlass,
  NotePencil,
  Sidebar,
  SidebarSimple,
} from "@anlg/ui/components/icons";
import { cn } from "@anlg/utils";

import { SidebarNoteFilterMenu } from "~/sidebar/note-filter-menu";

export const SidebarTimelineChrome = memo(function SidebarTimelineChrome({
  onNewNote,
  onSearch,
  onToggleSidebar,
  sidebarExpanded,
  showSidebarToggle = true,
}: {
  onNewNote: () => void;
  onSearch: () => void;
  onToggleSidebar: () => void;
  sidebarExpanded: boolean;
  showSidebarToggle?: boolean;
}) {
  return (
    <div data-tauri-drag-region className="flex w-full items-center">
      <div data-tauri-drag-region className="flex items-center gap-0">
        {showSidebarToggle && (
          <LeftSurfaceChromeButton
            ariaLabel={sidebarExpanded ? "Hide sidebar" : "Show sidebar"}
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
});

export function SidebarNoteActions({
  onNewNote,
  onSearch,
}: {
  onNewNote: () => void;
  onSearch: () => void;
}) {
  return (
    <>
      <LeftSurfaceChromeButton ariaLabel="Search" onClick={onSearch}>
        <MagnifyingGlass size={15} />
      </LeftSurfaceChromeButton>
      <LeftSurfaceChromeButton ariaLabel="New note" onClick={onNewNote}>
        <NotePencil size={15} />
      </LeftSurfaceChromeButton>
      <SidebarNoteFilterMenu />
    </>
  );
}

export function LeftSurfaceChromeButton({
  ariaLabel,
  children,
  disabled = false,
  onClick,
}: {
  ariaLabel: string;
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
    </button>
  );
}
