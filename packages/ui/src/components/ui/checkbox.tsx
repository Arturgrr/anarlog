import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as React from "react";

import { focusRingClassName } from "@anlg/ui/lib/focus-ring";
import { cn } from "@anlg/utils";

import { Check } from "../icons";

const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn([
      focusRingClassName,
      "peer bg-button-neutral shadow-button-neutral size-3.5 shrink-0 rounded-sm",
      "data-[state=checked]:bg-contrast data-[state=checked]:text-primary-foreground data-[state=checked]:shadow-button-contrast",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    ])}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn(["flex items-center justify-center text-current"])}
    >
      <Check className="size-3" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
