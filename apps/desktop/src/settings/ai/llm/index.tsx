import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";

import {
  browseLlmEntries,
  hasActiveLlmFilters,
  type LlmEntry,
  type LlmFilters,
  type LlmProviderGroup,
  llmProviderGroup,
  NO_LLM_FILTERS,
} from "./browse";
import { LlmProviderDetail } from "./detail";
import { LlmInUseBar } from "./in-use";
import { useLlmModelLists } from "./model-lists";
import { type Provider, PROVIDERS } from "./shared";
import { useLlmProviderStatuses } from "./status";
import {
  isSubscriptionProviderId,
  type SubscriptionProviderId,
} from "./subscriptions";
import { ConnectSubscriptionDialog } from "./subscriptions/connect";
import { useLlmSelection } from "./use-selection";

import {
  FilterBar,
  FilterChip,
  FilterDivider,
  FilterGroup,
} from "~/settings/ai/shared/filter-chips";
import { providerDisplayName } from "~/settings/ai/shared/provider-labels";
import {
  ProviderList,
  type ProviderListItem,
} from "~/settings/ai/shared/provider-list";
import type { ProviderSetup } from "~/settings/ai/shared/provider-setup";
import { MissingSetupLabel } from "~/settings/ai/shared/provider-setup-label";
import { ModelSettingsShell } from "~/settings/ai/shared/settings-shell";

export function LLM() {
  const { t, i18n } = useLingui();
  const statuses = useLlmProviderStatuses();
  const lists = useLlmModelLists(statuses.providers);
  const selection = useLlmSelection(statuses);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<LlmFilters>(NO_LLM_FILTERS);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [connectingId, setConnectingId] =
    useState<SubscriptionProviderId | null>(null);

  const visibleEntries = browseLlmEntries(PROVIDERS, lists, search, filters);
  const current = selection.current;
  const focused =
    visibleEntries.find(({ provider }) => provider.id === focusedId) ??
    visibleEntries.find(({ provider }) => provider.id === current?.provider) ??
    visibleEntries[0];
  const filtering = hasActiveLlmFilters(search, filters);
  const visibleModelCount = visibleEntries.reduce(
    (count, entry) => count + entry.models.length,
    0,
  );

  const toListItem = (entry: LlmEntry): ProviderListItem => ({
    id: entry.provider.id,
    name: providerDisplayName(entry.provider, i18n),
    icon: entry.provider.icon,
    ...describeLlmProvider(
      entry,
      statuses.providers[entry.provider.id]!.setup,
      entry.provider.id === current?.provider,
      i18n,
    ),
  });
  const groups = (
    [
      ["local", t`On this Mac`],
      ["subscription", t`Subscriptions`],
      ["api", t`API key`],
      ["custom", t`Custom`],
    ] as const satisfies ReadonlyArray<readonly [LlmProviderGroup, string]>
  ).flatMap(([group, label]) => {
    const items = visibleEntries
      .filter(({ provider }) => llmProviderGroup(provider) === group)
      .map(toListItem);
    return items.length > 0
      ? [{ id: group, label, items, collapsible: group === "api" }]
      : [];
  });

  const focusProvider = (providerId: string) => {
    if (!visibleEntries.some(({ provider }) => provider.id === providerId)) {
      setSearch("");
      setFilters(NO_LLM_FILTERS);
    }
    setFocusedId(providerId);
  };

  return (
    <>
      {selection.persistDefault}
      <ModelSettingsShell
        title={<Trans>Intelligence</Trans>}
        subtitle={
          <Trans>
            The model that writes summaries, answers in chat and titles your
            notes.
          </Trans>
        }
        search={search}
        onSearchChange={setSearch}
        inUse={
          <LlmInUseBar
            current={current}
            isPending={selection.isPending}
            metadata={
              current
                ? lists[current.provider]?.result?.metadata[current.model]
                : undefined
            }
            showMissingModelWarning={selection.showMissingModelWarning}
          />
        }
        filters={
          <FilterBar
            label={t`Filter providers and models`}
            summary={
              visibleModelCount > 0 ? (
                <Plural
                  value={visibleModelCount}
                  one="# model"
                  other="# models"
                />
              ) : undefined
            }
          >
            <FilterGroup label={t`Where it runs`}>
              {(
                [
                  ["all", t`All`],
                  ["local", t`On this Mac`],
                  ["subscription", t`Subscription`],
                  ["api", t`API key`],
                ] as const
              ).map(([where, label]) => (
                <FilterChip
                  key={where}
                  pressed={filters.where === where}
                  onClick={() => setFilters((value) => ({ ...value, where }))}
                >
                  {label}
                </FilterChip>
              ))}
            </FilterGroup>
            <FilterDivider />
            <FilterChip
              pressed={filters.readsImages}
              onClick={() =>
                setFilters((value) => ({
                  ...value,
                  readsImages: !value.readsImages,
                }))
              }
            >
              <Trans>Reads images</Trans>
            </FilterChip>
          </FilterBar>
        }
        isEmpty={visibleEntries.length === 0}
        onClearFilters={() => {
          setSearch("");
          setFilters(NO_LLM_FILTERS);
        }}
        list={
          <ProviderList
            label={t`Language model providers`}
            groups={groups}
            focusedId={focused?.provider.id}
            onFocus={setFocusedId}
            expandAll={filtering}
          />
        }
        detail={
          focused ? (
            <LlmProviderDetail
              key={focused.provider.id}
              entry={focused}
              setup={statuses.providers[focused.provider.id]!.setup}
              current={current}
              filtering={filtering}
              onSelect={selection.select}
              onConnect={(providerId) => {
                if (isSubscriptionProviderId(providerId)) {
                  setConnectingId(providerId);
                }
              }}
              onFocusProvider={focusProvider}
            />
          ) : null
        }
      />
      <ConnectSubscriptionDialog
        provider={
          connectingId
            ? PROVIDERS.find((provider) => provider.id === connectingId)
            : undefined
        }
        onOpenChange={(open) => {
          if (!open) {
            setConnectingId(null);
          }
        }}
      />
    </>
  );
}

function describeLlmProvider(
  { provider, list }: LlmEntry,
  setup: ProviderSetup,
  inUse: boolean,
  i18n: I18n,
): Pick<ProviderListItem, "subtitle" | "status" | "statusLabel"> {
  const subtitle = describeLlmSubtitle(provider, setup, list);

  if (inUse && setup.kind === "ready") {
    return { subtitle, status: "in_use" };
  }

  switch (setup.kind) {
    case "ready":
      return {
        subtitle,
        status: "connected",
        statusLabel:
          llmProviderGroup(provider) === "local"
            ? i18n._(msg`Available`)
            : i18n._(msg`Connected`),
      };
    case "checking":
      return { subtitle, status: "checking" };
    case "rejected":
      return { subtitle, status: "error" };
    default:
      return { subtitle, status: "inactive" };
  }
}

function describeLlmSubtitle(
  provider: Provider,
  setup: ProviderSetup,
  list: LlmEntry["list"],
) {
  switch (setup.kind) {
    case "checking":
      return <Trans>Checking…</Trans>;
    case "rejected":
      return <Trans>Key rejected</Trans>;
    case "stopped":
      return provider.id === "apple_foundation" ? (
        <Trans>Not available on this Mac</Trans>
      ) : (
        <Trans>Server stopped</Trans>
      );
    case "unavailable":
      return <Trans>Not available on this Mac</Trans>;
    case "missing":
      return (
        <MissingSetupLabel
          fields={setup.fields}
          subscription={provider.authKind === "subscription"}
        />
      );
    case "ready":
      if (list?.error) {
        return <Trans>Couldn’t load models</Trans>;
      }
      if (list?.result) {
        return (
          <Plural
            value={list.result.models.length}
            one="# model"
            other="# models"
          />
        );
      }
      return provider.id === "apple_foundation" ? (
        <Trans>Built into macOS</Trans>
      ) : (
        <Trans>Loading models…</Trans>
      );
  }
}
