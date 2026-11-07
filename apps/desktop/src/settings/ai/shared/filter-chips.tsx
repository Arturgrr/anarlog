import type { ReactNode } from "react";

import { focusRingClassName } from "@anlg/ui/lib/focus-ring";
import { cn } from "@anlg/utils";

export function FilterBar({
  label,
  children,
  summary,
}: {
  label: string;
  children: ReactNode;
  summary?: ReactNode;
}) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className="flex flex-wrap items-center gap-2"
    >
      {children}
      <span className="flex-1" />
      {summary ? <span className="text-faint text-xs">{summary}</span> : null}
    </div>
  );
}

export function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {children}
    </div>
  );
}

export function FilterDivider() {
  return <span aria-hidden className="bg-border h-[18px] w-px" />;
}

export function FilterChip({
  pressed,
  onClick,
  icon,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn([
        focusRingClassName,
        "inline-flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap",
        "transition-colors duration-150",
        pressed
          ? "bg-foreground text-card"
          : "text-muted-foreground hover:text-foreground shadow-[inset_0_0_0_1px_var(--color-border)]",
      ])}
    >
      {icon}
      {children}
    </button>
  );
}
