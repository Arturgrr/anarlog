import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";

import { Button } from "@anlg/ui/components/ui/button";
import { cn } from "@anlg/utils";

import { ProviderSearch } from "./provider-search";

import { SettingsPageTitle } from "~/settings/page-title";

export type ModelPickerVariant = "page" | "embedded";

export function ModelSettingsShell({
  variant,
  title,
  subtitle,
  search,
  onSearchChange,
  inUse,
  filters,
  list,
  detail,
  isEmpty,
  onClearFilters,
}: {
  variant: ModelPickerVariant;
  title: ReactNode;
  subtitle: ReactNode;
  search: string;
  onSearchChange: (value: string) => void;
  inUse: ReactNode;
  filters: ReactNode;
  list: ReactNode;
  detail: ReactNode;
  isEmpty: boolean;
  onClearFilters: () => void;
}) {
  const empty = isEmpty ? (
    <div className="border-border flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
      <p className="text-body text-muted-foreground">
        <Trans>No providers or models match your search and filters.</Trans>
      </p>
      <Button type="button" variant="outline" onClick={onClearFilters}>
        <Trans>Clear filters</Trans>
      </Button>
    </div>
  ) : null;

  if (variant === "embedded") {
    return (
      <div className="bg-raised border-border-weak @container flex min-h-0 flex-1 flex-col gap-2.5 rounded-xl border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">{filters}</div>
          <ProviderSearch value={search} onChange={onSearchChange} />
        </div>
        {empty ?? (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto @2xl:flex-row @2xl:overflow-hidden">
            <div
              className={cn([
                "flex shrink-0 flex-col",
                "@2xl:border-border-weak @2xl:w-64 @2xl:overflow-y-auto @2xl:border-r @2xl:pr-2.5",
              ])}
            >
              {list}
            </div>
            <div className="flex min-w-0 flex-col gap-5 @2xl:min-h-0 @2xl:flex-1 @2xl:overflow-y-auto @2xl:pr-1">
              {detail}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <SettingsPageTitle title={title} />
          <p className="text-body text-muted-foreground">{subtitle}</p>
        </div>
        <ProviderSearch value={search} onChange={onSearchChange} />
      </header>
      {inUse}
      {filters}
      {empty ?? (
        <div className="flex flex-wrap items-start gap-x-6 gap-y-5">
          <div className="flex min-w-0 flex-[1_1_264px] flex-col">{list}</div>
          <div className="flex min-w-0 flex-[999_1_420px] flex-col gap-5">
            {detail}
          </div>
        </div>
      )}
    </div>
  );
}
