import { i18n, type MessageDescriptor } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";

import { MagnifyingGlass, X } from "@anlg/ui/components/icons";

import { providerDisplayName } from "./provider-labels";

export function normalizeSearch(query: string) {
  return query.trim().toLocaleLowerCase();
}

export function matchesSearch(
  normalizedQuery: string,
  ...values: Array<string | undefined>
) {
  return (
    !normalizedQuery ||
    values.some((value) => value?.toLocaleLowerCase().includes(normalizedQuery))
  );
}

export function providerMatchesSearch(
  provider: {
    id: string;
    displayName: string;
    description?: string | MessageDescriptor;
  },
  normalizedQuery: string,
) {
  const description =
    typeof provider.description === "string"
      ? provider.description
      : provider.description
        ? i18n._(provider.description)
        : "";
  return matchesSearch(
    normalizedQuery,
    provider.displayName,
    providerDisplayName(provider, i18n),
    provider.id,
    description,
  );
}

export function ProviderSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLingui();

  return (
    <div className="bg-card shadow-button-neutral focus-within:outline-ring flex h-7 w-64 max-w-full items-center gap-2 rounded-md px-2 focus-within:outline focus-within:outline-1">
      <MagnifyingGlass
        className="text-muted-foreground size-3.5 shrink-0"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onChange("");
        }}
        placeholder={t`Search providers or models`}
        aria-label={t`Search providers or models`}
        className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm focus:outline-hidden [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
          aria-label={t`Clear search`}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
