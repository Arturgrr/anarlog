import type { ComponentProps } from "react";

import { cn } from "@anlg/utils";

export const floatingMenuSurfaceClassName =
  "bg-layer-1 text-popover-foreground shadow-floating overflow-hidden rounded-md p-0.5";

export const floatingMenuItemClassName = cn([
  "text-ui relative flex min-h-7 cursor-default items-center gap-2 rounded-sm py-1 pr-1.5 pl-3 outline-hidden select-none",
  "focus:bg-hover data-highlighted:bg-hover",
  "data-disabled:pointer-events-none data-disabled:opacity-50",
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
]);

export const appFloatingContentClassName = floatingMenuSurfaceClassName;
export const appFloatingMenuPanelClassName = "overflow-hidden";
export const appFloatingItemClassName = "rounded-sm";

export type FloatingContentVariant = "default" | "app";

export function AppFloatingPanel({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(["text-popover-foreground rounded-sm", className])}
      {...props}
    />
  );
}
