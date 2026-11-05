import * as React from "react";

import { cn } from "@anlg/utils";

import { inputSurfaceClassName } from "./input";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn([
        inputSurfaceClassName,
        "text-ui flex min-h-[60px] w-full px-2 py-1.5",
        className,
      ])}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
