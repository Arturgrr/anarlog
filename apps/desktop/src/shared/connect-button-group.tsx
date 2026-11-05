import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { ButtonGroup } from "@anlg/ui/components/ui/button-group";
import { cn } from "@anlg/utils";

export function ConnectButtonGroup({
  primary,
  busy = false,
  busyLabel,
  children,
}: {
  primary: boolean;
  busy?: boolean;
  busyLabel?: string;
  children: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <div
      className={cn([
        "focus-within:outline-ring relative w-40 shrink-0 overflow-hidden rounded-md focus-within:outline-2 focus-within:outline-offset-[2.5px]",
        primary
          ? "bg-primary shadow-button-contrast"
          : "bg-button-neutral shadow-button-neutral",
      ])}
    >
      {busy && (
        <motion.span
          role="progressbar"
          aria-label={busyLabel}
          className={cn([
            "bg-primary-foreground/20 pointer-events-none absolute inset-y-0 left-0",
            reducedMotion ? "w-full" : "w-1/3",
          ])}
          animate={reducedMotion ? undefined : { x: ["-100%", "300%"] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
        />
      )}
      <ButtonGroup className="relative w-full [&>button:first-child]:min-w-0 [&>button:first-child]:flex-1 [&>button:last-child]:shrink-0">
        {children}
      </ButtonGroup>
    </div>
  );
}
