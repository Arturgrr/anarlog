import * as React from "react";

import { cn } from "@anlg/utils";

export const inputSurfaceClassName = cn([
  "bg-card text-foreground shadow-button-neutral rounded-md",
  "bg-[linear-gradient(to_bottom,rgb(255_255_255/0.06),rgb(255_255_255/0.02))]",
  "transition-[box-shadow,outline-color] duration-200 ease-out",
  "placeholder:text-faint",
  "focus-visible:outline-ring focus-visible:shadow-none focus-visible:outline-1",
  "aria-invalid:outline-danger aria-invalid:shadow-none aria-invalid:outline-1",
  "disabled:cursor-not-allowed disabled:opacity-50",
]);

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn([
          inputSurfaceClassName,
          "text-ui-compact flex h-7 w-full px-2 py-1",
          "file:text-foreground file:border-0 file:bg-transparent file:text-sm file:font-medium",
          className,
        ])}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
