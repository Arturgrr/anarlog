import { useLingui } from "@lingui/react/macro";
import { useCallback } from "react";

import { Square } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { cn } from "@anlg/utils";

import { FolderPicker } from "../folder-picker";
import { RecordingIcon, useHasTranscript } from "../shared";
import { TitleInput } from "../title-input";
import { OverflowButton } from "./overflow";

import { useAudioPlayer } from "~/audio-player";
import { useShell } from "~/contexts/shell";
import {
  usesWindowsStyleTitleBar,
  useWindowControlsGutter,
  WINDOW_CONTROLS_GUTTER_CLASS,
  WINDOW_CONTROLS_GUTTER_PLUS_40_CLASS,
} from "~/shared/hooks/useWindowControlsGutter";
import type { EditorView, Tab } from "~/store/zustand/tabs/schema";
import { useListener } from "~/stt/contexts";
import { useStartListening } from "~/stt/useStartListening";
import {
  isMainWebviewWindow,
  requestMainListenerControl,
} from "~/stt/window-control";

export function OuterHeader({
  sessionId,
  currentView,
  tab,
  standaloneWindow = false,
  viewSwitcher,
}: {
  sessionId: string;
  currentView: EditorView;
  tab?: Extract<Tab, { type: "sessions" }>;
  standaloneWindow?: boolean;
  viewSwitcher?: React.ReactNode;
}) {
  const { leftsidebar } = useShell();
  const sessionMode = useListener((state) => state.getSessionMode(sessionId));
  const hasTranscript = useHasTranscript(sessionId);
  const { audioExists } = useAudioPlayer();
  const showWindowControlsGutter = useWindowControlsGutter();
  const showSidebarTimelineHeaderGutter =
    !standaloneWindow && !leftsidebar.expanded && !usesWindowsStyleTitleBar();
  const isRecording =
    sessionMode === "active" || sessionMode === "running_batch";
  const isLiveMeeting = isRecording || sessionMode === "finalizing";
  const meetingOver = !isRecording && (hasTranscript || audioExists);
  const showFolderBreadcrumb =
    Boolean(tab) && !viewSwitcher && !isLiveMeeting && !meetingOver;

  return (
    <div
      data-tauri-drag-region
      className={cn([
        "relative flex w-full items-center gap-[2px]",
        // 46px content box centers the 28px controls at 23px, matching the
        // sidebar toggle row (pt-[9px] + size-7).
        "h-12 pb-0.5",
        standaloneWindow &&
          (showWindowControlsGutter ? WINDOW_CONTROLS_GUTTER_CLASS : "pl-2"),
        !standaloneWindow && !showSidebarTimelineHeaderGutter && "pl-2",
        showSidebarTimelineHeaderGutter &&
          (showWindowControlsGutter
            ? WINDOW_CONTROLS_GUTTER_PLUS_40_CLASS
            : "pl-[40px]"),
      ])}
    >
      {viewSwitcher}
      {tab ? (
        <div
          className={cn([
            "flex min-w-0 shrink items-center gap-1",
            !showFolderBreadcrumb && "ml-2",
          ])}
        >
          {showFolderBreadcrumb ? (
            <>
              <FolderPicker sessionId={sessionId} />
              <span
                aria-hidden="true"
                className="text-muted-foreground shrink-0"
              >
                /
              </span>
            </>
          ) : null}
          <div className="max-w-56 min-w-0 shrink">
            <TitleInput key={tab.id} tab={tab} variant="breadcrumb" />
          </div>
        </div>
      ) : null}
      <div
        data-tauri-drag-region
        data-session-header-spacer
        className="min-h-full min-w-0 flex-1"
      />
      <div
        data-tauri-drag-region
        className="relative z-10 flex shrink-0 items-center pr-1"
      >
        {!showFolderBreadcrumb && (
          <FolderPicker sessionId={sessionId} align="end" />
        )}
        <HeaderMeetingControl
          sessionId={sessionId}
          sessionMode={sessionMode}
          meetingOver={meetingOver}
        />
        <OverflowButton
          standaloneWindow={standaloneWindow}
          sessionId={sessionId}
          currentView={currentView}
        />
      </div>
    </div>
  );
}

function HeaderMeetingControl({
  sessionId,
  sessionMode,
  meetingOver,
}: {
  sessionId: string;
  sessionMode: string;
  meetingOver: boolean;
}) {
  if (
    sessionMode === "finalizing" ||
    sessionMode === "running_batch" ||
    meetingOver
  ) {
    return null;
  }

  return (
    <HeaderMeetingAction sessionId={sessionId} sessionMode={sessionMode} />
  );
}

function HeaderMeetingAction({
  sessionId,
  sessionMode,
}: {
  sessionId: string;
  sessionMode: string;
}) {
  const startListening = useStartListening(sessionId);
  const stop = useListener((state) => state.stop);
  const { t } = useLingui();
  const start = useCallback(async () => {
    if (!isMainWebviewWindow()) {
      await requestMainListenerControl("start", sessionId);
      return;
    }

    await startListening();
  }, [sessionId, startListening]);
  const stopListening = useCallback(() => {
    if (!isMainWebviewWindow()) {
      void requestMainListenerControl("stop", sessionId);
      return;
    }

    stop();
  }, [sessionId, stop]);
  const action =
    sessionMode === "active"
      ? {
          label: t`Stop`,
          title: t`Stop listening`,
          icon: <Square className="size-3" />,
          onClick: stopListening,
        }
      : {
          label: t`Record`,
          title: t`Record`,
          icon: <RecordingIcon />,
          onClick: start,
        };
  const disabled = sessionMode === "finalizing";
  return (
    <div className="relative mr-1 ml-1 flex min-w-0 shrink-0 items-center">
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-tauri-drag-region="false"
        aria-label={action.label}
        title={action.title}
        disabled={disabled}
        onClick={action.onClick}
        className={cn([
          "max-w-56 shrink-0 gap-1.5 overflow-hidden pr-2.5 pl-1.5 text-sm",
          disabled && "cursor-default opacity-60",
        ])}
      >
        {action.icon}
        <span className="truncate">{action.label}</span>
      </Button>
    </div>
  );
}
