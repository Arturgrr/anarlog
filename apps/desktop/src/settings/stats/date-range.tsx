import { useLingui } from "@lingui/react/macro";

import { Button } from "@anlg/ui/components/ui/button";
import { cn } from "@anlg/utils";

export function DateRangeFilter({
  value,
  onChange,
}: {
  value: "all" | "30d" | "7d";
  onChange: (value: "all" | "30d" | "7d") => void;
}) {
  const { t } = useLingui();
  const ranges = [
    { id: "all", label: t`All time` },
    { id: "30d", label: t`30 days` },
    { id: "7d", label: t`7 days` },
  ] as const;

  return (
    <div
      className="bg-layer-1 ring-border flex h-7 gap-0.5 rounded-md p-0.5 ring-[0.5px]"
      role="group"
      aria-label={t`Date range`}
    >
      {ranges.map((option) => (
        <Button
          key={option.id}
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn([
            "h-6 rounded-sm px-3 py-0 text-sm font-normal shadow-none transition-[background-color,color,box-shadow] duration-200 ease-out",
            value === option.id
              ? "bg-card text-foreground ring-border-strong hover:bg-card active:bg-card ring-[0.5px]"
              : "text-muted-foreground hover:text-foreground hover:bg-transparent active:bg-transparent",
          ])}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
