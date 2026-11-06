import { Trans, useLingui } from "@lingui/react/macro";
import {
  memo,
  type RefCallback,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";
import { cn } from "@anlg/utils";

import { useAnchor, useAutoScrollToAnchor } from "./anchor";
import { TimelineBuckets } from "./buckets";
import { TimelineNowChip } from "./chips";
import { getFallbackIndicatorIndex, useTimelineData } from "./data";
import {
  hasSidebarNoteSelectionContext,
  isDeleteSelectionShortcut,
  isSelectAllShortcut,
  isSessionItemKey,
  isTextEditingShortcutTarget,
  scrollTimelineItemIntoView,
  shouldClearTimelineSelectionOnPointerDown,
} from "./interaction";
import { useTimelineSessionsTable } from "./queries";
import { useCurrentTimeMs } from "./realtime";

import { useDeleteSession } from "~/session/hooks/useDeleteSession";
import { useConfigValue } from "~/shared/config";
import { scrollElementByWheel } from "~/shared/dom/scroll-wheel";
import { useNativeContextMenu } from "~/shared/hooks/useNativeContextMenu";
import { DestructiveConfirmationDialog } from "~/shared/ui/destructive-confirmation-dialog";
import { useSidebarNotes } from "~/sidebar/note-filter";
import { useTabs } from "~/store/zustand/tabs";
import { useTimelineSelection } from "~/store/zustand/timeline-selection";
import { useListener } from "~/stt/contexts";

export const TimelineView = memo(function TimelineView({
  folderFilter = null,
  topChipsOverlapHeader = false,
  topChromeInset = false,
}: {
  folderFilter?: string | null;
  topChipsOverlapHeader?: boolean;
  topChromeInset?: boolean;
} = {}) {
  const { t } = useLingui();
  const timezone = useConfigValue("timezone") || undefined;
  const timelineSessionsTable = useTimelineSessionsTable();
  const groupBy = useSidebarNotes((state) => state.groupBy);
  const sortOrder = useSidebarNotes((state) => state.sortOrder);
  const isDateTimeline = groupBy === "date";
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);

  const buckets = useTimelineData({
    folderFilter,
    groupBy,
    sortOrder,
    timelineSessionsTable,
    timezone,
  });

  const hasToday = useMemo(
    () => isDateTimeline && buckets.some((bucket) => bucket.label === "Today"),
    [buckets, isDateTimeline],
  );
  const indicatorTimeMs = useCurrentTimeMs();
  const activeSessionId = useListener((state) =>
    state.live.status === "active" || state.live.status === "finalizing"
      ? state.live.sessionId
      : null,
  );
  const hasActiveVisibleSession = useMemo(
    () =>
      !!activeSessionId &&
      buckets.some((bucket) =>
        bucket.items.some((item) => item.id === activeSessionId),
      ),
    [activeSessionId, buckets],
  );

  const currentTab = useTabs((state) => state.currentTab);

  const selectedSessionId = useMemo(() => {
    return currentTab?.type === "sessions" ? currentTab.id : undefined;
  }, [currentTab]);

  const selectedIds = useTimelineSelection((s) => s.selectedIds);
  const anchorId = useTimelineSelection((s) => s.anchorId);
  const selectAll = useTimelineSelection((s) => s.selectAll);
  const clearSelection = useTimelineSelection((s) => s.clear);
  const deleteSession = useDeleteSession();
  const [pendingDeleteSessionIds, setPendingDeleteSessionIds] = useState<
    string[]
  >([]);

  const handleRequestDeleteSelected = useCallback(() => {
    const sessionIds = selectedIds
      .filter(isSessionItemKey)
      .map((key) => key.replace("session-", ""));

    if (sessionIds.length > 0) {
      setPendingDeleteSessionIds(sessionIds);
    }
  }, [selectedIds]);

  const handleConfirmDeleteSelected = useCallback(() => {
    const sessionIds = pendingDeleteSessionIds;
    const batchId = sessionIds.length > 1 ? crypto.randomUUID() : undefined;

    setPendingDeleteSessionIds([]);
    for (const sessionId of sessionIds) {
      deleteSession(sessionId, {
        batchId,
        title: timelineSessionsTable?.[sessionId]?.title ?? undefined,
      });
    }

    clearSelection();
  }, [
    pendingDeleteSessionIds,
    deleteSession,
    clearSelection,
    timelineSessionsTable,
  ]);

  const sessionCount = useMemo(
    () => selectedIds.filter(isSessionItemKey).length,
    [selectedIds],
  );

  const flatItemKeys = useMemo(() => {
    const keys: string[] = [];
    for (const bucket of buckets) {
      for (const item of bucket.items) {
        keys.push(`${item.type}-${item.id}`);
      }
    }
    return keys;
  }, [buckets]);
  const flatItemKeysRef = useRef(flatItemKeys);
  flatItemKeysRef.current = flatItemKeys;
  const getFlatItemKeys = useCallback(() => flatItemKeysRef.current, []);
  const flatSessionItemKeys = useMemo(
    () => flatItemKeys.filter(isSessionItemKey),
    [flatItemKeys],
  );
  const shortcutStateRef = useRef({
    anchorId,
    clearSelection,
    flatSessionItemKeys,
    handleRequestDeleteSelected,
    selectedIds,
    selectedSessionId,
    selectAll,
  });
  shortcutStateRef.current = {
    anchorId,
    clearSelection,
    flatSessionItemKeys,
    handleRequestDeleteSelected,
    selectedIds,
    selectedSessionId,
    selectAll,
  };

  const {
    containerRef,
    isAnchorVisible: isTodayVisible,
    isScrolledPastAnchor: isScrolledPastToday,
    scrollToAnchor: scrollToToday,
    registerAnchor: setCurrentTimeIndicatorRef,
    anchorNode: todayAnchorNode,
  } = useAnchor();
  const showTopNowChip =
    isDateTimeline && !isTodayVisible && isScrolledPastToday;
  const bucketHeaderTopClassName = topChromeInset ? "top-12" : "top-0";
  const topChipStackTopClassName = topChromeInset
    ? "top-4"
    : topChipsOverlapHeader
      ? "top-1"
      : "top-2";
  const selectedSessionScrollFrameRef = useRef<number | null>(null);
  const scrollSelectedSessionIntoView = useCallback<
    RefCallback<HTMLDivElement>
  >(
    (node) => {
      if (selectedSessionScrollFrameRef.current !== null) {
        cancelAnimationFrame(selectedSessionScrollFrameRef.current);
        selectedSessionScrollFrameRef.current = null;
      }

      if (!node || currentTab?.type !== "sessions") {
        return;
      }

      selectedSessionScrollFrameRef.current = requestAnimationFrame(() => {
        selectedSessionScrollFrameRef.current = null;
        scrollTimelineItemIntoView(containerRef.current, node);
      });
    },
    [containerRef, currentTab],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateScrollPosition = () => {
      const maxScrollTop = Math.max(
        0,
        container.scrollHeight - container.clientHeight,
      );
      setIsScrolledToBottom(maxScrollTop - container.scrollTop <= 12);
    };

    updateScrollPosition();
    container.addEventListener("scroll", updateScrollPosition, {
      passive: true,
    });

    return () => {
      container.removeEventListener("scroll", updateScrollPosition);
    };
  }, [containerRef, buckets.length, flatItemKeys.length]);

  const todayBucketLength = useMemo(() => {
    const b = buckets.find((bucket) => bucket.label === "Today");
    return b?.items.length ?? 0;
  }, [buckets]);
  const autoScrollAnchorNode = hasToday ? todayAnchorNode : null;

  useAutoScrollToAnchor({
    scrollFn: scrollToToday,
    isVisible: isTodayVisible,
    anchorNode: autoScrollAnchorNode,
    deps: [todayBucketLength],
  });

  useMountEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const container = containerRef.current;

      if (
        !container ||
        container.closest("[inert], [aria-hidden='true']") ||
        event.defaultPrevented ||
        isTextEditingShortcutTarget(event.target) ||
        isTextEditingShortcutTarget(document.activeElement)
      ) {
        return;
      }

      const {
        anchorId,
        flatSessionItemKeys,
        handleRequestDeleteSelected,
        selectedIds,
        selectedSessionId,
        selectAll,
      } = shortcutStateRef.current;

      if (isDeleteSelectionShortcut(event)) {
        if (!selectedIds.some(isSessionItemKey)) {
          return;
        }

        event.preventDefault();
        handleRequestDeleteSelected();
        return;
      }

      if (isSelectAllShortcut(event)) {
        if (
          !selectedSessionId ||
          flatSessionItemKeys.length === 0 ||
          !hasSidebarNoteSelectionContext({
            anchorId,
            selectedIds,
            selectedSessionId,
          })
        ) {
          return;
        }

        event.preventDefault();
        selectAll(flatSessionItemKeys);
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const { clearSelection, selectedIds } = shortcutStateRef.current;

      if (
        selectedIds.length === 0 ||
        !shouldClearTimelineSelectionOnPointerDown(event.target)
      ) {
        return;
      }

      clearSelection();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("pointerdown", handlePointerDown, {
      capture: true,
    });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("pointerdown", handlePointerDown, {
        capture: true,
      });
    };
  });

  const indicatorIndex = useMemo(() => {
    if (!isDateTimeline || hasToday) {
      return -1;
    }
    return getFallbackIndicatorIndex(buckets, Date.now(), sortOrder);
  }, [buckets, hasToday, indicatorTimeMs, isDateTimeline, sortOrder]);

  const contextMenuItems = useMemo(
    () => [
      {
        id: "delete-selected",
        text: t`Delete Selected (${sessionCount})`,
        action: handleRequestDeleteSelected,
        accelerator: "Backspace",
        disabled: sessionCount === 0,
      },
    ],
    [sessionCount, handleRequestDeleteSelected, t],
  );

  const showContextMenu = useNativeContextMenu(contextMenuItems);
  const handleWheelCapture = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      const target = event.target;

      if (
        !container ||
        event.defaultPrevented ||
        (target instanceof Node && container.contains(target))
      ) {
        return;
      }

      scrollElementByWheel(container, event);
    },
    [containerRef],
  );

  const pendingDeleteCount = pendingDeleteSessionIds.length;

  return (
    <>
      <DestructiveConfirmationDialog
        open={pendingDeleteCount > 0}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteSessionIds([]);
        }}
        title={
          pendingDeleteCount === 1
            ? t`Delete 1 selected note?`
            : t`Delete ${pendingDeleteCount} selected notes?`
        }
        description={t`You can undo this action for a short time.`}
        confirmLabel={t`Delete`}
        onConfirm={handleConfirmDeleteSelected}
      />
      <div
        data-sidebar-timeline-root
        className="relative h-full"
        onWheelCapture={handleWheelCapture}
      >
        <div
          ref={containerRef}
          data-sidebar-timeline-scroll
          onContextMenu={selectedIds.length > 0 ? showContextMenu : undefined}
          className={cn([
            "scrollbar-hide flex h-full flex-col overflow-y-auto",
            "rounded-xl",
          ])}
        >
          {topChromeInset && (
            <div
              aria-hidden
              data-sidebar-timeline-top-spacer
              className="h-12 shrink-0"
            />
          )}
          <TimelineBuckets
            bucketHeaderTopClassName={bucketHeaderTopClassName}
            buckets={buckets}
            emptyTodayLabel={<Trans>No items today</Trans>}
            getFlatItemKeys={getFlatItemKeys}
            hasActiveVisibleSession={hasActiveVisibleSession}
            hasToday={hasToday}
            indicatorIndex={indicatorIndex}
            registerIndicator={setCurrentTimeIndicatorRef}
            selectedIds={selectedIds}
            selectedNodeRef={scrollSelectedSessionIntoView}
            selectedSessionId={selectedSessionId}
            showCurrentTimeIndicator={isDateTimeline}
            sortOrder={sortOrder}
            timezone={timezone}
          />
        </div>

        {!isScrolledToBottom && (
          <div
            aria-hidden
            data-sidebar-timeline-bottom-fade
            className="from-background/0 to-background pointer-events-none absolute inset-x-0 bottom-0 z-30 h-7 bg-linear-to-b"
          />
        )}

        {topChromeInset && (
          <div
            aria-hidden
            data-sidebar-timeline-top-occluder
            className="bg-background pointer-events-none absolute inset-x-0 top-0 z-10 h-12"
          />
        )}

        {showTopNowChip && (
          <div
            data-sidebar-timeline-top-chip-stack
            className={cn([
              "absolute left-1/2 z-20 flex -translate-x-1/2 transform flex-col items-center gap-2",
              topChipStackTopClassName,
            ])}
          >
            <TimelineNowChip
              ariaLabel={t`Go back to now`}
              direction="up"
              onClick={scrollToToday}
            >
              <Trans>Now</Trans>
            </TimelineNowChip>
          </div>
        )}

        {isDateTimeline && !isTodayVisible && !isScrolledPastToday && (
          <TimelineNowChip
            ariaLabel={t`Go back to now`}
            onClick={scrollToToday}
            direction="down"
            className={cn([
              "absolute bottom-2 left-1/2 -translate-x-1/2 transform",
              "z-40",
            ])}
          >
            <Trans>Now</Trans>
          </TimelineNowChip>
        )}
      </div>
    </>
  );
});
