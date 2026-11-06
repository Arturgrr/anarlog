import { useLingui } from "@lingui/react/macro";
import { platform } from "@tauri-apps/plugin-os";
import {
  memo,
  type DragEvent,
  type RefCallback,
  useCallback,
  useMemo,
  useState,
} from "react";

import { commands as fsSyncCommands } from "@anlg/plugin-fs-sync";
import { commands as openerCommands } from "@anlg/plugin-opener2";
import {
  FolderSimple,
  Lock,
  LockOpen,
  Square,
} from "@anlg/ui/components/icons";
import { DancingSticks } from "@anlg/ui/components/ui/dancing-sticks";
import { Spinner } from "@anlg/ui/components/ui/spinner";
import { cn, format, getYear, safeParseDate, TZDate } from "@anlg/utils";

import type { TimelineItem, TimelinePrecision } from "./utils";

import { writeSessionContextDragData } from "~/chat/context/session-drag";
import { DEVICE_AUTH_REASON } from "~/lock/auth";
import { isLockedFlag } from "~/lock/flag";
import { revealLockedNote, setSessionLocked } from "~/lock/notes";
import { useAppLock } from "~/lock/store";
import { useDeleteSession } from "~/session/hooks/useDeleteSession";
import { useIsSessionEnhancing } from "~/session/hooks/useEnhancedNotes";
import { preloadSession } from "~/session/queries";
import { openStandaloneNoteWindow } from "~/session/window";
import { useConfigValue } from "~/shared/config";
import type { MenuItemDef } from "~/shared/hooks/useNativeContextMenu";
import { useTimeFormat } from "~/shared/hooks/useTimeFormat";
import { InteractiveButton } from "~/shared/ui/interactive-button";
import {
  formatSidebarItemTags,
  resolveSidebarItemMeta,
} from "~/sidebar/item-fields";
import { useSidebarNotes } from "~/sidebar/note-filter";
import { useSessionTitle } from "~/store/zustand/live-title";
import { useTabs } from "~/store/zustand/tabs";
import { useTimelineSelection } from "~/store/zustand/timeline-selection";
import { useListener } from "~/stt/contexts";

const EMPTY_TIMELINE_ITEM_KEYS: string[] = [];

type ItemBaseProps = {
  title: string;
  displayTime: string;
  folder?: string;
  tags?: string[];
  isLive?: boolean;
  amplitude?: number;
  showSpinner?: boolean;
  isLocked?: boolean;
  isLockRevealed?: boolean;
  selected: boolean;
  multiSelected: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  onCmdClick: () => void;
  onShiftClick: () => void;
  onStop?: () => void;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  contextMenu: MenuItemDef[];
  draggable?: boolean;
  selectedNodeRef?: RefCallback<HTMLDivElement>;
  timelineSessionId?: string;
  onPreload?: () => void;
};

export const TimelineItemComponent = memo(
  ({
    item,
    precision,
    selected,
    timezone,
    multiSelected,
    flatItemKeys,
    getFlatItemKeys,
    selectedNodeRef,
  }: {
    item: TimelineItem;
    precision: TimelinePrecision;
    selected: boolean;
    timezone?: string;
    multiSelected: boolean;
    flatItemKeys?: string[];
    getFlatItemKeys?: () => string[];
    selectedNodeRef?: RefCallback<HTMLDivElement>;
  }) => {
    const readFlatItemKeys =
      getFlatItemKeys ?? (() => flatItemKeys ?? EMPTY_TIMELINE_ITEM_KEYS);

    return (
      <SessionItem
        item={item}
        precision={precision}
        selected={selected}
        timezone={timezone}
        multiSelected={multiSelected}
        getFlatItemKeys={readFlatItemKeys}
        selectedNodeRef={selectedNodeRef}
      />
    );
  },
);

const ItemBase = memo(function ItemBase({
  title,
  displayTime,
  folder,
  tags,
  isLive,
  amplitude,
  showSpinner,
  isLocked,
  isLockRevealed,
  selected,
  multiSelected,
  onClick,
  onDoubleClick,
  onCmdClick,
  onShiftClick,
  onStop,
  onDragStart,
  contextMenu,
  draggable,
  selectedNodeRef,
  timelineSessionId,
  onPreload,
}: ItemBaseProps) {
  const { t } = useLingui();
  const hasSelection = useTimelineSelection((s) => s.selectedIds.length > 0);
  const showLiveStop = isLive && onStop;
  const folderLabel = folder ?? "";
  const tagLine = formatSidebarItemTags(tags ?? []);
  const extraRows = Number(Boolean(folderLabel)) + Number(Boolean(tagLine));

  return (
    <div
      ref={selectedNodeRef}
      data-sidebar-timeline-session-id={timelineSessionId}
      onFocus={onPreload}
      onPointerDown={onPreload}
      className={cn([
        "group/sidebar-live-item relative [content-visibility:auto]",
        extraRows === 2
          ? "[contain-intrinsic-size:auto_88px]"
          : extraRows === 1
            ? "[contain-intrinsic-size:auto_72px]"
            : "[contain-intrinsic-size:auto_56px]",
      ])}
    >
      <InteractiveButton
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onCmdClick={onCmdClick}
        onShiftClick={onShiftClick}
        onDragStart={onDragStart}
        contextMenu={hasSelection ? undefined : contextMenu}
        className={cn([
          "w-full cursor-pointer rounded-md px-3 py-2 text-left",
          showLiveStop && "pr-10",
          multiSelected && "bg-layer-2",
          !multiSelected && selected && "bg-layer-2",
          !multiSelected && !selected && "hover:bg-hover active:bg-pressed",
          isLive && [
            "bg-contrast text-primary-foreground shadow-button-contrast hover:bg-contrast/90",
            "focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-2",
          ],
        ])}
        draggable={draggable}
      >
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {folderLabel ? (
              <div
                className={cn([
                  "pointer-events-none flex min-w-0 items-center gap-1 text-[11px] leading-4",
                  isLive
                    ? "text-primary-foreground/65"
                    : "text-muted-foreground",
                ])}
              >
                <FolderSimple className="size-3 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">{folderLabel}</span>
              </div>
            ) : null}
            <div className="font-ui-medium pointer-events-none min-w-0 truncate text-sm">
              {title || t`Untitled`}
            </div>
            {displayTime && (
              <div
                className={cn([
                  "font-mono text-xs",
                  isLive
                    ? "text-primary-foreground/65"
                    : "text-muted-foreground",
                ])}
              >
                {displayTime}
              </div>
            )}
            {tagLine ? (
              <div
                className={cn([
                  "pointer-events-none min-w-0 truncate text-[11px] leading-4",
                  isLive
                    ? "text-primary-foreground/65"
                    : "text-muted-foreground",
                ])}
              >
                {tagLine}
              </div>
            ) : null}
          </div>
          {isLocked ? (
            isLockRevealed ? (
              <LockOpen
                aria-label={t`Unlock Note`}
                className="text-muted-foreground size-3.5 shrink-0"
              />
            ) : (
              <Lock
                aria-label={t`Locked note`}
                className="text-muted-foreground size-3.5 shrink-0"
              />
            )
          ) : null}
          {showSpinner ? (
            <Spinner
              size={14}
              aria-hidden
              className="text-muted-foreground shrink-0"
            />
          ) : null}
        </div>
      </InteractiveButton>
      {showLiveStop ? (
        <button
          type="button"
          aria-label={t`Stop listening`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onStop();
          }}
          className={cn([
            "absolute top-1/2 right-3 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm",
            "text-white/80 transition-colors hover:bg-white/15 hover:text-white",
            "focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-hidden",
          ])}
        >
          <span
            aria-hidden
            className="flex items-center justify-center group-hover/sidebar-live-item:hidden"
          >
            <DancingSticks
              amplitude={amplitude ?? 0.25}
              color="currentColor"
              height={14}
              width={13}
              stickWidth={2}
              gap={2}
            />
          </span>
          <span
            aria-hidden
            className="hidden items-center justify-center group-hover/sidebar-live-item:flex"
          >
            <Square size={10} />
          </span>
        </button>
      ) : null}
    </div>
  );
}, itemBasePropsAreEqual);

function itemBasePropsAreEqual(prev: ItemBaseProps, next: ItemBaseProps) {
  return (
    prev.title === next.title &&
    prev.displayTime === next.displayTime &&
    prev.folder === next.folder &&
    (prev.tags ?? []).join("\u001f") === (next.tags ?? []).join("\u001f") &&
    prev.isLive === next.isLive &&
    prev.amplitude === next.amplitude &&
    prev.showSpinner === next.showSpinner &&
    prev.isLocked === next.isLocked &&
    prev.isLockRevealed === next.isLockRevealed &&
    prev.selected === next.selected &&
    prev.multiSelected === next.multiSelected &&
    prev.onClick === next.onClick &&
    prev.onDoubleClick === next.onDoubleClick &&
    prev.onCmdClick === next.onCmdClick &&
    prev.onShiftClick === next.onShiftClick &&
    prev.onStop === next.onStop &&
    prev.onDragStart === next.onDragStart &&
    prev.contextMenu === next.contextMenu &&
    prev.draggable === next.draggable &&
    prev.selectedNodeRef === next.selectedNodeRef &&
    prev.timelineSessionId === next.timelineSessionId &&
    prev.onPreload === next.onPreload
  );
}

const SessionItem = memo(
  ({
    item,
    precision,
    selected,
    timezone,
    multiSelected,
    getFlatItemKeys,
    selectedNodeRef,
  }: {
    item: TimelineItem;
    precision: TimelinePrecision;
    selected: boolean;
    timezone?: string;
    multiSelected: boolean;
    getFlatItemKeys: () => string[];
    selectedNodeRef?: RefCallback<HTMLDivElement>;
  }) => {
    const { t } = useLingui();
    const openCurrent = useTabs((state) => state.openCurrent);
    const deleteSession = useDeleteSession();

    const sessionId = item.id;
    const title = useSessionTitle(sessionId, item.data.title ?? undefined);
    const groupBy = useSidebarNotes((state) => state.groupBy);
    const showFolder = useConfigValue("sidebar_show_folder");
    const showTags = useConfigValue("sidebar_show_tags");
    const { folder, tags } = resolveSidebarItemMeta({
      folderId: item.data.folder_id,
      tags: item.data.tags,
      showFolder,
      showTags,
      groupBy,
    });
    const noteLocked = isLockedFlag(item.data.locked);
    const noteRevealed = useAppLock((state) =>
      Boolean(state.revealedNoteIds[sessionId]),
    );
    const authAvailable = useAppLock((state) => state.available) === true;

    const { sessionMode, stop, amplitude } = useListener((state) => {
      const sessionMode = state.getSessionMode(sessionId);
      return {
        sessionMode,
        stop: state.stop,
        amplitude: sessionMode === "active" ? state.live.amplitude : null,
      };
    });
    const isEnhancing = useIsSessionEnhancing(sessionId);
    const isLive = sessionMode === "active";
    const isFinalizing = sessionMode === "finalizing";
    const isBatching = sessionMode === "running_batch";
    const [isOpening, setIsOpening] = useState(false);
    const showSpinner =
      !selected &&
      !isLive &&
      (isFinalizing || isEnhancing || isBatching || isOpening);

    const timeFormat = useTimeFormat();
    const displayTime = useMemo(
      () =>
        formatDisplayTime(
          item.data.created_at,
          precision,
          timezone,
          timeFormat,
        ),
      [item.data.created_at, precision, timezone, timeFormat],
    );

    const itemKey = `session-${item.id}`;

    const handlePreload = useCallback(() => {
      if (!noteLocked) void preloadSession(sessionId).catch(() => {});
    }, [noteLocked, sessionId]);

    const openSession = useCallback(async () => {
      setIsOpening(true);
      try {
        await preloadSession(sessionId);
      } catch (error) {
        console.error("[timeline] failed to preload session", error);
      } finally {
        openCurrent({ id: sessionId, type: "sessions" });
        setIsOpening(false);
      }
    }, [openCurrent, sessionId]);

    const handleClick = useCallback(() => {
      useTimelineSelection.getState().setAnchor(itemKey);
      if (noteLocked) {
        void revealLockedNote(sessionId).then((ok) => {
          if (ok) void openSession();
        });
        return;
      }
      void openSession();
    }, [noteLocked, sessionId, openSession, itemKey]);

    const handleCmdClick = useCallback(() => {
      useTimelineSelection.getState().toggleSelect(itemKey);
    }, [itemKey]);

    const handleShiftClick = useCallback(() => {
      useTimelineSelection.getState().selectRange(getFlatItemKeys(), itemKey);
    }, [getFlatItemKeys, itemKey]);

    const handleOpenStandaloneWindow = useCallback(() => {
      void openStandaloneNoteWindow(sessionId);
    }, [sessionId]);

    const handleDragStart = useCallback(
      (event: DragEvent<HTMLElement>) => {
        writeSessionContextDragData(
          event.dataTransfer,
          sessionId,
          title || t`Untitled`,
        );
      },
      [sessionId, title, t],
    );

    const handleDelete = useCallback(() => {
      deleteSession(sessionId, { title });
    }, [deleteSession, sessionId, title]);

    const handleToggleLock = useCallback(() => {
      void setSessionLocked(sessionId, !noteLocked);
    }, [noteLocked, sessionId]);

    const handleShowInFolder = useCallback(async () => {
      if (noteLocked) {
        const ok = await useAppLock
          .getState()
          .authenticate(DEVICE_AUTH_REASON.openApp);
        if (!ok) return;
      }
      const result = await fsSyncCommands.sessionDir(sessionId);
      if (result.status === "ok") {
        await openerCommands.openPath(result.data, null);
      }
    }, [noteLocked, sessionId]);

    const contextMenu = useMemo(() => {
      const menu: MenuItemDef[] = [
        {
          id: "open-new-window",
          text: t`Open in New Window`,
          action: handleOpenStandaloneWindow,
        },
        {
          id: "show",
          text: platform() === "macos" ? t`Show in Finder` : t`Show in folder`,
          action: handleShowInFolder,
        },
      ];
      if (authAvailable) {
        menu.push({
          id: noteLocked ? "unlock" : "lock",
          text: noteLocked ? t`Unlock Note` : t`Lock Note`,
          action: handleToggleLock,
        });
      }
      menu.push(
        { separator: true as const },
        {
          id: "delete",
          text: t`Delete Note`,
          action: handleDelete,
        },
      );
      return menu;
    }, [
      authAvailable,
      handleDelete,
      handleOpenStandaloneWindow,
      handleShowInFolder,
      handleToggleLock,
      noteLocked,
      t,
    ]);

    return (
      <ItemBase
        title={title}
        displayTime={displayTime}
        folder={folder}
        tags={tags}
        isLive={isLive}
        amplitude={Math.max(
          0.25,
          Math.min(Math.hypot(amplitude?.mic ?? 0, amplitude?.speaker ?? 0), 1),
        )}
        showSpinner={showSpinner}
        isLocked={noteLocked}
        isLockRevealed={noteRevealed}
        selected={selected}
        multiSelected={multiSelected}
        onClick={handleClick}
        onDoubleClick={handleOpenStandaloneWindow}
        onCmdClick={handleCmdClick}
        onShiftClick={handleShiftClick}
        onStop={stop}
        onDragStart={handleDragStart}
        contextMenu={contextMenu}
        selectedNodeRef={selected ? selectedNodeRef : undefined}
        timelineSessionId={sessionId}
        onPreload={handlePreload}
        draggable
      />
    );
  },
);

function formatDisplayTime(
  timestamp: string | null | undefined,
  precision: TimelinePrecision,
  timezone: string | undefined,
  timeFormat: string,
): string {
  const parsed = safeParseDate(timestamp);
  if (!parsed) {
    return "";
  }

  const date = timezone ? new TZDate(parsed, timezone) : parsed;
  const time = format(date, timeFormat).toUpperCase();

  if (precision === "time") {
    return time;
  }

  const now = timezone ? new TZDate(new Date(), timezone) : new Date();
  const sameYear = getYear(date) === getYear(now);
  const dateStr = sameYear
    ? format(date, "MMM d")
    : format(date, "MMM d, yyyy");

  return `${dateStr}, ${time}`;
}
