import { type KeyboardEvent, type ReactNode, useId } from "react";

import { focusRingClassName } from "@anlg/ui/lib/focus-ring";
import { cn } from "@anlg/utils";

export function ModelOptionList({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  // Arrow keys move focus only; selecting stays an explicit Enter or Space,
  // because every selection is persisted and health-checked right away.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) {
      return;
    }

    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "[role=radio]:not(:disabled)",
      ),
    );
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) {
      return;
    }

    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : Math.min(
              options.length - 1,
              Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)),
            );
    options[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={cn(["flex flex-col gap-1.5", className])}
    >
      {children}
    </div>
  );
}

export function ModelOption({
  name,
  checked,
  disabled = false,
  tabbable,
  onSelect,
  chips,
  description,
  details,
  aside,
  compact = false,
}: {
  name: ReactNode;
  checked: boolean;
  disabled?: boolean;
  tabbable: boolean;
  onSelect: () => void;
  chips?: ReactNode;
  description?: ReactNode;
  details?: ReactNode;
  aside?: ReactNode;
  compact?: boolean;
}) {
  const nameId = useId();
  const descriptionId = useId();
  const hasDescription = !!description || !!details;

  return (
    <div
      className={cn([
        "flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border",
        compact ? "px-3 py-2" : "px-3.5 py-3",
        checked ? "border-border-strong bg-hover" : "border-border",
      ])}
    >
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        aria-labelledby={nameId}
        aria-describedby={hasDescription ? descriptionId : undefined}
        disabled={disabled}
        tabIndex={tabbable ? 0 : -1}
        onClick={onSelect}
        className={cn([
          focusRingClassName,
          "flex min-w-0 flex-[1_1_15rem] items-start gap-3 rounded-sm text-left",
          disabled ? "cursor-default" : "cursor-pointer",
        ])}
      >
        <span
          aria-hidden
          className={cn([
            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px]",
            checked ? "border-foreground" : "border-border-std",
            disabled && "opacity-50",
          ])}
        >
          {checked ? (
            <span className="bg-foreground size-2 rounded-full" />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              id={nameId}
              className={cn([
                "min-w-0 font-medium break-words",
                disabled && "text-muted-foreground",
              ])}
            >
              {name}
            </span>
            {chips}
          </span>
          {hasDescription ? (
            <span id={descriptionId} className="flex flex-col gap-1">
              {description ? (
                <span className="text-muted-foreground">{description}</span>
              ) : null}
              {details}
            </span>
          ) : null}
        </span>
      </button>
      {aside ? (
        <div className="ml-auto flex shrink-0 flex-col items-end gap-2">
          {aside}
        </div>
      ) : null}
    </div>
  );
}
