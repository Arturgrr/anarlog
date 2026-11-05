import { cn } from "@anlg/utils";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn([
        "text-small font-ui-medium pointer-events-none inline-flex h-5 w-fit min-w-5 shrink-0 items-center justify-center gap-1 rounded-sm px-1.5 font-sans whitespace-nowrap select-none",
        "bg-button-neutral text-muted-foreground shadow-keycap",
        "[&_svg:not([class*='size-'])]:size-3",
        className,
      ])}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="kbd-group"
      className={cn(["inline-flex items-center gap-0.5", className])}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
