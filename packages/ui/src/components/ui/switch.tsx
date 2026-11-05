import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { focusRingClassName } from "@anlg/ui/lib/focus-ring";
import { cn } from "@anlg/utils";

const switchVariants = cva(
  cn([
    focusRingClassName,
    "peer group/switch relative inline-flex shrink-0 cursor-pointer rounded-full",
    "transition-[background-color,box-shadow] duration-200 ease-out",
    "bg-layer-4 shadow-switch-off bg-[linear-gradient(to_bottom,rgb(255_255_255/0),rgb(255_255_255/0.2))]",
    "data-[state=checked]:bg-contrast data-[state=checked]:shadow-switch-on data-[state=checked]:bg-[linear-gradient(to_bottom,rgb(255_255_255/0),rgb(255_255_255/0.1))]",
    "disabled:cursor-not-allowed disabled:opacity-50",
  ]),
  {
    variants: {
      size: {
        sm: "h-3.5 w-7",
        default: "h-4 w-9",
        lg: "h-5 w-11",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

// The knob stretches toward the track's centre on hover and press, so its
// width is a variable the checked position subtracts from the far edge.
const thumbVariants = cva(
  cn([
    "pointer-events-none absolute top-px left-px block w-(--knob-w) rounded-full",
    "transition-[left,width] duration-200 ease-out",
    "bg-switch-knob shadow-elements border-[0.5px] border-white bg-[linear-gradient(to_bottom,rgb(255_255_255/1),rgb(255_255_255/0))]",
    "data-[state=checked]:bg-switch-knob-on data-[state=checked]:left-[calc(100%-1px-var(--knob-w))]",
  ]),
  {
    variants: {
      size: {
        sm: "h-3 [--knob-w:16px] group-hover/switch:[--knob-w:18px] group-active/switch:[--knob-w:20px]",
        default:
          "h-3.5 [--knob-w:21px] group-hover/switch:[--knob-w:23px] group-active/switch:[--knob-w:26px]",
        lg: "h-[18px] [--knob-w:26px] group-hover/switch:[--knob-w:28px] group-active/switch:[--knob-w:31px]",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

interface SwitchProps
  extends
    React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>,
    VariantProps<typeof switchVariants> {}

const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitives.Root>,
  SwitchProps
>(({ className, size, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn([switchVariants({ size, className })])}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb className={cn([thumbVariants({ size })])} />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
