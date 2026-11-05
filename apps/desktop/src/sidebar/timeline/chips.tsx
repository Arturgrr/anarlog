import type { ReactNode } from "react";

import { ArrowDown, ArrowUp, Sun } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { focusRingClassName } from "@anlg/ui/lib/focus-ring";
import { cn } from "@anlg/utils";

export function UpcomingMeetingChip({
  ariaLabel,
  label,
  onClick,
}: {
  ariaLabel: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <TimelineTopChip
      aria-live="polite"
      ariaLabel={ariaLabel}
      data-sidebar-upcoming-meeting-status
      className="bg-contrast text-primary-foreground shadow-button-contrast hover:bg-contrast/90 hover:text-primary-foreground active:bg-contrast/80 w-28 justify-center"
      icon={<ArrowUp aria-hidden className="size-3" weight="bold" />}
      onClick={onClick}
    >
      {label}
    </TimelineTopChip>
  );
}

export function TimelineTopChip({
  ariaLabel,
  children,
  icon,
  onClick,
  ...props
}: {
  ariaLabel?: string;
  children: ReactNode;
  icon: ReactNode;
  className?: string;
  role?: string;
  "aria-live"?: "off" | "polite" | "assertive";
  "data-sidebar-upcoming-meeting-status"?: true;
  onClick?: () => void;
}) {
  const className = cn([
    "bg-button-neutral text-muted-foreground shadow-button-neutral flex h-6 items-center gap-1 rounded-sm border-0 px-2.5 text-xs font-medium",
    onClick && "hover:bg-layer-2 active:bg-layer-3 hover:text-foreground",
    focusRingClassName,
    props.className,
  ]);

  if (onClick) {
    return (
      <Button
        {...props}
        aria-label={ariaLabel}
        className={className}
        onClick={onClick}
        size="sm"
        variant="outline"
      >
        <span className="flex size-3 shrink-0 items-center justify-center">
          {icon}
        </span>
        <span className="truncate">{children}</span>
      </Button>
    );
  }

  return (
    <div {...props} aria-label={ariaLabel} className={className}>
      <span className="flex size-3 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="truncate">{children}</span>
    </div>
  );
}

export function TimelineNowChip({
  ariaLabel,
  children,
  className,
  direction,
  onClick,
}: {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  direction: "up" | "down";
  onClick: () => void;
}) {
  const DirectionIcon = direction === "up" ? ArrowUp : ArrowDown;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={cn([
        "bg-button-neutral text-foreground shadow-floating flex h-6 items-center gap-1 rounded-sm px-2.5 text-xs font-semibold",
        "hover:bg-layer-2 active:bg-layer-3 hover:text-foreground",
        focusRingClassName,
        className,
      ])}
      onClick={onClick}
    >
      {direction === "up" ? <DirectionIcon size={12} /> : null}
      <Sun size={13} className="text-icon shrink-0" />
      <span>{children}</span>
      {direction === "down" ? <DirectionIcon size={12} /> : null}
    </button>
  );
}
