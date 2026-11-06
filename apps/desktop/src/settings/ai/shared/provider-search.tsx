import { i18n, type MessageDescriptor } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";

import { MagnifyingGlass, X } from "@anlg/ui/components/icons";

import { providerDisplayName } from "./provider-labels";

export function filterProviders<
  T extends {
    id: string;
    displayName: string;
    description?: string | MessageDescriptor;
  },
>(providers: readonly T[], query: string): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return [...providers];
  }

  return providers.filter((provider) => {
    const description =
      typeof provider.description === "string"
        ? provider.description
        : provider.description
          ? i18n._(provider.description)
          : "";
    return `${provider.displayName} ${providerDisplayName(provider, i18n)} ${provider.id} ${description}`
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });
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
    <div className="bg-card shadow-button-neutral focus-within:outline-ring ml-auto flex h-7 w-56 max-w-[55%] items-center gap-2 rounded-md px-2 focus-within:outline focus-within:outline-1">
      <MagnifyingGlass className="text-muted-foreground size-3.5 shrink-0" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onChange("");
        }}
        placeholder={t`Search providers...`}
        aria-label={t`Search providers`}
        className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm focus:outline-hidden [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
          aria-label={t`Clear search`}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
