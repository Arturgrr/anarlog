import { Trans, useLingui } from "@lingui/react/macro";
import { motion, useReducedMotion } from "motion/react";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import type {
  FloatingBarState,
  FloatingTranscriptBubble,
} from "@anlg/plugin-windows";
import {
  ArrowsInSimple,
  ArrowsOutSimple,
  CaretDown,
  Square,
  WarningCircle,
  X,
} from "@anlg/ui/components/icons";
import { DancingSticks } from "@anlg/ui/components/ui/dancing-sticks";
import { cn } from "@anlg/utils";

import {
  FLOATING_BAR_COMPACT_GAP,
  FLOATING_BAR_COMPACT_HEIGHT,
  FLOATING_BAR_COMPACT_HORIZONTAL_PADDING,
  FLOATING_BAR_COMPACT_ICON_SIZE,
  FLOATING_BAR_COMPACT_SOLO_STOP_WIDTH,
  FLOATING_BAR_COMPACT_STOP_WIDTH,
  FLOATING_BAR_COMPACT_RADIUS,
  FLOATING_BAR_CONTROL_RADIUS,
  FLOATING_BAR_EXPANDED_RADIUS,
  FLOATING_BAR_HOVER_HANDLE_HEIGHT,
  FLOATING_BAR_HOVER_HANDLE_TOP_PADDING,
  FLOATING_BAR_HOVER_HANDLE_RESERVED_HEIGHT,
  FLOATING_BAR_INSET,
  compactControlsWidth,
} from "./layout";

export function FloatingBarOverlay({
  state,
  onStop,
  onToggleExpanded,
  onHide,
}: {
  state: FloatingBarState;
  onStop: () => void;
  onToggleExpanded: (expanded: boolean) => void;
  onHide: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const reduceMotion = useReducedMotion();
  const isExpanded =
    state.liveCaptionToggleVisible && !state.liveCaptionMinimized;
  const showsHoverHandle = hovered && !isExpanded;
  const colors = barColors(state);
  const controlsWidth = compactControlsWidth(state.liveCaptionToggleVisible);
  const expandsUpward = state.layout?.expandsUpward ?? false;

  return (
    <div
      className="relative h-full w-full"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {isExpanded && (
        <div
          data-tauri-drag-region
          className="absolute inset-x-0 top-0"
          style={{
            height:
              FLOATING_BAR_INSET + FLOATING_BAR_HOVER_HANDLE_RESERVED_HEIGHT,
          }}
        />
      )}
      {/* The window is reused across meetings; each one enters like the HUD. */}
      <motion.div
        key={state.sessionId ?? undefined}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={reduceMotion ? { duration: 0.16 } : HUD_TRANSITION}
        className="absolute overflow-hidden"
        style={{
          left: FLOATING_BAR_INSET,
          right: FLOATING_BAR_INSET,
          bottom: FLOATING_BAR_INSET,
          top:
            FLOATING_BAR_INSET +
            (showsHoverHandle ? 0 : FLOATING_BAR_HOVER_HANDLE_RESERVED_HEIGHT),
          borderRadius: isExpanded
            ? FLOATING_BAR_EXPANDED_RADIUS
            : FLOATING_BAR_COMPACT_RADIUS,
          background:
            hovered && !isExpanded ? colors.envelopeSurface : colors.surface,
          boxShadow: `inset 0 0 0 0.5px ${colors.rim}, 0 1px 2px ${colors.shadow}`,
        }}
      >
        {showsHoverHandle && <HoverHandle color={colors.handle} />}
        <div
          className="absolute inset-x-0 bottom-0"
          style={{
            top: showsHoverHandle
              ? FLOATING_BAR_HOVER_HANDLE_RESERVED_HEIGHT
              : 0,
          }}
        >
          {isExpanded && (
            <div
              className="absolute inset-x-0"
              style={{
                top: expandsUpward ? 0 : FLOATING_BAR_COMPACT_HEIGHT,
                bottom: expandsUpward ? FLOATING_BAR_COMPACT_HEIGHT : 0,
              }}
            >
              <TranscriptList
                bubbles={state.transcriptBubbles ?? []}
                colors={colors}
                notice={state.transcriptNotice ?? null}
              />
            </div>
          )}
          <div
            className="absolute flex -translate-x-1/2 items-center justify-center"
            style={{
              left: state.layout
                ? state.layout.controlsCenterX - FLOATING_BAR_INSET
                : `calc(100% - ${FLOATING_BAR_COMPACT_HORIZONTAL_PADDING + controlsWidth / 2}px)`,
              top: expandsUpward ? undefined : 0,
              bottom: expandsUpward ? 0 : undefined,
              width: controlsWidth,
              height: FLOATING_BAR_COMPACT_HEIGHT,
            }}
          >
            <FloatingControls
              state={state}
              isExpanded={isExpanded}
              colors={colors}
              onStop={onStop}
              onToggleExpanded={onToggleExpanded}
              onHide={onHide}
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function FloatingControls({
  state,
  isExpanded,
  colors,
  onStop,
  onToggleExpanded,
  onHide,
}: {
  state: FloatingBarState;
  isExpanded: boolean;
  colors: BarColors;
  onStop: () => void;
  onToggleExpanded: (expanded: boolean) => void;
  onHide: () => void;
}) {
  const { t } = useLingui();

  return (
    <div
      className="flex items-center"
      style={
        {
          gap: FLOATING_BAR_COMPACT_GAP,
          "--control-fill": colors.controlFill,
        } as CSSProperties
      }
    >
      <StopControl state={state} colors={colors} onStop={onStop} />
      {state.liveCaptionToggleVisible ? (
        <button
          type="button"
          data-tauri-drag-region="false"
          aria-label={
            isExpanded ? t`Collapse live transcript` : t`Expand live transcript`
          }
          onClick={() => onToggleExpanded(!isExpanded)}
          className={CONTROL_CLASS_NAME}
          style={{
            width: FLOATING_BAR_COMPACT_ICON_SIZE,
            height: FLOATING_BAR_COMPACT_ICON_SIZE,
            borderRadius: FLOATING_BAR_CONTROL_RADIUS,
            color: colors.content,
          }}
        >
          {isExpanded ? (
            <ArrowsInSimple size={14} weight="bold" />
          ) : (
            <ArrowsOutSimple size={14} weight="bold" />
          )}
        </button>
      ) : null}
      <button
        type="button"
        data-tauri-drag-region="false"
        aria-label={t`Hide floating bar`}
        title={t`Hide floating bar`}
        onClick={onHide}
        className={CONTROL_CLASS_NAME}
        style={{
          width: FLOATING_BAR_COMPACT_ICON_SIZE,
          height: FLOATING_BAR_COMPACT_ICON_SIZE,
          borderRadius: FLOATING_BAR_CONTROL_RADIUS,
          color: colors.muted,
        }}
      >
        <X size={14} weight="bold" />
      </button>
    </div>
  );
}

function StopControl({
  state,
  colors,
  onStop,
}: {
  state: FloatingBarState;
  colors: BarColors;
  onStop: () => void;
}) {
  const { t } = useLingui();
  const [hovered, setHovered] = useState(false);
  const notice = state.transcriptNotice ?? t`Recording needs attention`;
  const width = state.liveCaptionToggleVisible
    ? FLOATING_BAR_COMPACT_STOP_WIDTH
    : FLOATING_BAR_COMPACT_SOLO_STOP_WIDTH;

  return (
    <button
      type="button"
      data-tauri-drag-region="false"
      aria-label={
        state.status === "error"
          ? t`${notice}; stop listening`
          : t`Stop listening`
      }
      title={
        state.status === "error"
          ? t`${notice}. Open Librelog to retry or change devices.`
          : undefined
      }
      onClick={onStop}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex items-center justify-center transition-colors"
      style={{
        width,
        height: FLOATING_BAR_COMPACT_ICON_SIZE,
        borderRadius: FLOATING_BAR_CONTROL_RADIUS,
        background: hovered ? colors.dangerFill : "transparent",
        color: colors.danger,
      }}
    >
      {hovered ? (
        <span className="flex items-center gap-1.5 text-[13px] font-medium">
          <Square size={9} />
          <Trans>Stop</Trans>
        </span>
      ) : state.status === "error" ? (
        <WarningCircle size={20} aria-hidden="true" />
      ) : (
        <DancingSticks
          color={colors.danger}
          amplitude={state.amplitude}
          width={26}
          height={20}
          stickWidth={3}
          gap={2}
        />
      )}
    </button>
  );
}

function TranscriptList({
  bubbles,
  colors,
  notice,
}: {
  bubbles: FloatingTranscriptBubble[];
  colors: BarColors;
  notice: string | null;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    if (pinned) {
      bottomRef.current?.scrollIntoView?.({ block: "end" });
    }
  }, [bubbles, pinned, notice]);

  return (
    <div className="relative h-full p-3">
      <div
        className="h-full overflow-y-auto"
        onScroll={(event) => {
          const target = event.currentTarget;
          const distance =
            target.scrollHeight - target.scrollTop - target.clientHeight;
          setPinned(distance < 20);
        }}
      >
        <div className="flex min-h-full flex-col justify-end gap-2">
          {bubbles.map((bubble, index) => (
            <TranscriptBubble
              key={bubble.id}
              bubble={bubble}
              colors={colors}
              showsSpeakerLabel={
                index === 0 ||
                bubbles[index - 1]?.speakerLabel !== bubble.speakerLabel ||
                bubbles[index - 1]?.isSelf !== bubble.isSelf
              }
            />
          ))}
          {notice ? (
            <p
              role="status"
              className="px-3 py-1.5 text-center text-[12px] leading-4"
              style={{ color: colors.muted }}
            >
              {notice}
            </p>
          ) : null}
          <div ref={bottomRef} />
        </div>
      </div>
      {!pinned && bubbles.length > 0 ? (
        <button
          type="button"
          data-tauri-drag-region="false"
          onClick={() => {
            setPinned(true);
            bottomRef.current?.scrollIntoView?.({
              block: "end",
              behavior: "smooth",
            });
          }}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium"
          style={{
            background: colors.chip,
            boxShadow: `inset 0 0 0 0.5px ${colors.rim}`,
            color: colors.content,
          }}
        >
          <CaretDown size={10} weight="bold" />
          <Trans>Go to bottom</Trans>
        </button>
      ) : null}
    </div>
  );
}

function TranscriptBubble({
  bubble,
  showsSpeakerLabel,
  colors,
}: {
  bubble: FloatingTranscriptBubble;
  showsSpeakerLabel: boolean;
  colors: BarColors;
}) {
  const overlapping = bubble.overlapsPrevious || bubble.overlapsNext;

  return (
    <div
      className={cn(["flex", bubble.isSelf ? "justify-end" : "justify-start"])}
    >
      <div className="max-w-[calc(100%-40px)] text-left">
        {(showsSpeakerLabel || overlapping) && (
          <p
            className="mb-1 text-[10px] font-semibold"
            style={{ color: colors.content }}
          >
            {showsSpeakerLabel ? bubble.speakerLabel : ""}
          </p>
        )}
        <p
          className="rounded-[11px] px-2.5 py-2 text-[13px] leading-5 font-[440]"
          style={{
            color: colors.content,
            background: bubble.isSelf ? colors.selfBubble : colors.bubble,
            boxShadow: overlapping
              ? `inset 0 0 0 1px ${colors.overlap}`
              : undefined,
          }}
        >
          {bubble.text}
        </p>
      </div>
    </div>
  );
}

function HoverHandle({ color }: { color: string }) {
  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-center"
      style={{
        height: FLOATING_BAR_HOVER_HANDLE_HEIGHT,
        width: "100%",
        paddingTop: FLOATING_BAR_HOVER_HANDLE_TOP_PADDING,
        boxSizing: "content-box",
      }}
    >
      <div
        data-tauri-drag-region
        className="h-full"
        style={{
          width: "calc(100% - 16px)",
          backgroundImage: `radial-gradient(circle, ${color} 0.8px, transparent 0.9px)`,
          backgroundSize: "5px 7px",
        }}
      />
    </div>
  );
}

const CONTROL_CLASS_NAME =
  "flex items-center justify-center transition-colors hover:bg-(--control-fill)";

/**
 * The dictation HUD's springs. Motion's `visualDuration` is 1/1.2 of
 * SwiftUI's spring duration, so 0.25 here is the HUD's 0.3 s.
 */
const HUD_TRANSITION = {
  scale: { type: "spring", visualDuration: 0.25, bounce: 0.15 },
  opacity: { type: "spring", visualDuration: 0.25, bounce: 0 },
} as const;

type BarColors = ReturnType<typeof barColors>;

/** The opacity setting's default, which draws the dictation HUD's plate. */
const DEFAULT_OPACITY = 0.78;

/**
 * The dictation HUD's plate, rim, shadow and ink from the graphite tokens:
 * white in the light appearance, #191919 in the dark one. The shadow is the
 * HUD's colour pulled in to fit the window's 4 px inset. Red is the only hue,
 * for recording and errors, which is what tells this bar from the HUD.
 */
function barColors(state: FloatingBarState) {
  const opacity = Math.min(Math.max(state.opacity, 0.35), 0.95);
  const dark = state.colorScheme === "dark";
  const plate = dark ? "25, 25, 25" : "255, 255, 255";
  const ink = dark ? "250, 250, 250" : "22, 22, 22";
  const surface = Math.min(
    (opacity / DEFAULT_OPACITY) * (dark ? 0.94 : 0.96),
    0.98,
  );

  return {
    surface: `rgba(${plate}, ${surface})`,
    envelopeSurface: `rgba(${plate}, ${Math.min(surface + 0.04, 0.98)})`,
    rim: dark ? "rgba(255, 255, 255, 0.16)" : "rgba(0, 0, 0, 0.12)",
    shadow: dark ? "rgba(0, 0, 0, 0.45)" : "rgba(0, 0, 0, 0.12)",
    content: `rgb(${ink})`,
    muted: "#808080",
    handle: `rgba(${ink}, ${dark ? 0.48 : 0.36})`,
    controlFill: `rgba(${ink}, ${dark ? 0.08 : 0.07})`,
    bubble: `rgba(${ink}, ${dark ? 0.07 : 0.045})`,
    selfBubble: `rgba(${ink}, ${dark ? 0.12 : 0.08})`,
    overlap: `rgba(${ink}, ${dark ? 0.26 : 0.2})`,
    chip: dark ? "#232323" : "#F3F3F3",
    danger: dark ? "#F17471" : "#B82D35",
    dangerFill: dark ? "rgba(241, 116, 113, 0.18)" : "rgba(184, 45, 53, 0.14)",
  };
}
