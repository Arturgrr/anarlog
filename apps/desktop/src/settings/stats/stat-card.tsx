import { cn } from "@anlg/utils";

export function StatCard({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn(["bg-card shadow-raised rounded-lg p-4", className])}>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-2 text-3xl font-medium tracking-tight tabular-nums">
        {value}
      </dd>
    </div>
  );
}
