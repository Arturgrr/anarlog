import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";

import { Button } from "@anlg/ui/components/ui/button";

import { ProviderSearch } from "./provider-search";

import { SettingsPageTitle } from "~/settings/page-title";

export function ModelSettingsShell({
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
      {isEmpty ? (
        <div className="border-border flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
          <p className="text-body text-muted-foreground">
            <Trans>No providers or models match your search and filters.</Trans>
          </p>
          <Button type="button" variant="outline" onClick={onClearFilters}>
            <Trans>Clear filters</Trans>
          </Button>
        </div>
      ) : (
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
