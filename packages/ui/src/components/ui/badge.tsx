import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@anlg/utils";

const badgeVariants = cva(
  "focus:outline-ring text-small font-ui-medium inline-flex h-[18px] items-center gap-1 rounded-xs border-[0.5px] px-1.5 whitespace-nowrap focus:outline-2 focus:outline-offset-2",
  {
    variants: {
      variant: {
        default: "bg-contrast text-primary-foreground border-transparent",
        secondary: "bg-layer-2 text-muted-foreground border-border",
        destructive: "bg-danger-bg text-danger border-danger-border",
        outline: "text-muted-foreground border-border-strong",
        success: "bg-layer-2 text-foreground border-border",
      },
      size: {
        default: "",
        sm: "h-4 px-1",
        lg: "text-ui h-5 px-2",
      },
      disabled: {
        true: "pointer-events-none cursor-not-allowed opacity-50",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      disabled: false,
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    React.RefAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  label?: string;
}

function Badge({
  className,
  variant,
  size,
  disabled,
  label,
  children,
  ref,
  ...props
}: BadgeProps) {
  return (
    <div
      className={cn([badgeVariants({ variant, size, disabled }), className])}
      aria-label={label}
      role="status"
      {...props}
      ref={ref}
    >
      {children}
    </div>
  );
}

export { Badge, badgeVariants };
