import type { ReactNode } from "react";

import { ArrowDown, ArrowUp, Sun } from "@anlg/ui/components/icons";
import { focusRingClassName } from "@anlg/ui/lib/focus-ring";
import { cn } from "@anlg/utils";

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
