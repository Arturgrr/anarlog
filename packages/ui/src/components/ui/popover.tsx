import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";

import { cn } from "@anlg/utils";

import {
  AppFloatingPanel,
  appFloatingContentClassName,
  appFloatingMenuPanelClassName,
  type FloatingContentVariant,
} from "./floating-content";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
    variant?: FloatingContentVariant;
  }
>(
  (
    {
      className,
      align = "center",
      sideOffset = 4,
      collisionPadding = 8,
      variant = "default",
      ...props
    },
    ref,
  ) => (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn([
          "text-popover-foreground data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out z-50 w-72 origin-(--radix-popover-content-transform-origin) outline-hidden",
          variant === "app"
            ? appFloatingContentClassName
            : "bg-popover border-border-std/50 rounded-lg border p-4 shadow-md",
          className,
        ])}
        {...props}
      />
    </PopoverPrimitive.Portal>
  ),
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export {
  AppFloatingPanel,
  appFloatingMenuPanelClassName,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
};
