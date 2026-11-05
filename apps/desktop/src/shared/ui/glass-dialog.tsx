import type { ComponentProps } from "react";

import { Button } from "@anlg/ui/components/ui/button";
import { DialogContent } from "@anlg/ui/components/ui/dialog";
import { cn } from "@anlg/utils";

export function GlassDialogContent({
  className,
  ...props
}: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      overlayClassName="bg-scrim"
      className={cn([
        "w-[calc(100vw-48px)] max-w-[320px] gap-4 overflow-hidden rounded-md p-4 sm:rounded-md",
        "bg-layer-1 shadow-overlay border-0",
        "[&>button:last-child]:hidden",
        className,
      ])}
      {...props}
    />
  );
}

export function GlassDialogCancelButton({
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(["h-7 px-3", className])}
      {...props}
    />
  );
}
