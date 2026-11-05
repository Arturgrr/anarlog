"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { motion } from "motion/react";
import * as React from "react";

import { cn } from "@anlg/utils";

function TooltipProvider({
  delayDuration = 500,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
}

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TOOLTIP_OFFSET = {
  top: { y: 4 },
  bottom: { y: -4 },
  left: { x: 4 },
  right: { x: -4 },
};

const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, side = "top", ...props }, ref) => {
  const initialPosition = TOOLTIP_OFFSET[side];

  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        side={side}
        asChild
        {...props}
      >
        <motion.div
          initial={{ opacity: 0, ...initialPosition }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, ...initialPosition }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className={cn([
            "z-50 max-w-[300px] overflow-hidden rounded-[5px] px-[7px] py-1 text-xs",
            "bg-tooltip text-tooltip-foreground border-tooltip-border border-[0.5px] shadow-md",
            "origin-(--radix-tooltip-content-transform-origin)",
            className,
          ])}
        >
          {props.children}
        </motion.div>
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
});
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
