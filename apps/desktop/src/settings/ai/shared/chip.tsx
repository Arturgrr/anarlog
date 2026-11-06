import type { ReactNode } from "react";

import { cn } from "@anlg/utils";

export function Chip({
  children,
  emphasis = false,
  title,
}: {
  children: ReactNode;
  emphasis?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn([
        "inline-flex h-[18px] shrink-0 items-center gap-1 rounded-xs border-[0.5px] px-1.5",
        "text-small bg-layer-2 font-medium whitespace-nowrap",
        emphasis
          ? "border-border-strong text-foreground"
          : "border-border text-muted-foreground",
      ])}
    >
      {children}
    </span>
  );
}
