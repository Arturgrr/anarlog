import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { focusRingClassName } from "@anlg/ui/lib/focus-ring";
import { cn } from "@anlg/utils";

// Overlays paint through a pseudo-element so hover/press tint any fill,
// including the contrast skin's sheen, without swapping its background.
const buttonVariants = cva(
  cn([
    focusRingClassName,
    "text-ui font-ui-medium relative isolate inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md whitespace-nowrap select-none",
    "transition-[opacity,box-shadow] duration-200 ease-out",
    "before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:content-['']",
    "disabled:pointer-events-none disabled:cursor-not-allowed",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ]),
  {
    variants: {
      variant: {
        default: cn([
          "bg-contrast text-primary-foreground shadow-button-contrast",
          "bg-[linear-gradient(to_bottom,rgb(255_255_255/0.2),rgb(255_255_255/0))]",
          "hover:before:bg-contrast-hover active:before:bg-contrast-pressed",
          "disabled:opacity-40",
        ]),
        destructive: cn([
          "bg-button-neutral text-danger shadow-button-neutral",
          "hover:before:bg-hover active:before:bg-pressed",
          "disabled:opacity-50",
        ]),
        outline: cn([
          "bg-button-neutral text-foreground shadow-button-neutral",
          "hover:before:bg-hover active:before:bg-pressed",
          "disabled:opacity-50",
        ]),
        secondary: cn([
          "bg-button-neutral text-foreground shadow-button-neutral",
          "hover:before:bg-hover active:before:bg-pressed",
          "disabled:opacity-50",
        ]),
        ghost: cn([
          "hover:before:bg-hover active:before:bg-pressed",
          "aria-expanded:before:bg-pressed data-[state=open]:before:bg-pressed",
          "disabled:opacity-50",
        ]),
        link: "text-foreground underline-offset-4 hover:underline disabled:opacity-50",
      },
      size: {
        default: "h-7 px-[11px]",
        sm: "h-6 rounded-sm px-[9px]",
        lg: "text-body h-9 rounded-xl px-[18px]",
        icon: "size-7",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn([buttonVariants({ variant, size, className })])}
        {...props}
        ref={ref}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
