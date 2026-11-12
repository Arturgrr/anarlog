import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";

import { usesDeferredProviderAuthentication } from "@anlg/provider-validation";
import { Check } from "@anlg/ui/components/icons";

import {
  browseSttEntries,
  hasActiveSttFilters,
  NO_STT_FILTERS,
  type SttEntry,
  sttEntryModels,
  type SttFilters,
} from "./browse";
import {
  sttProviderGroup,
  type SttProviderGroup,
  useSttCatalog,
} from "./catalog";
import { SttSettingsProvider } from "./context";
import { SttProviderDetail } from "./detail";
import { SttInUseBar } from "./in-use";
import {
  formatLanguageList,
  languageSupportKey,
  useSttLanguageSupport,
  useTranscriptionLanguages,
} from "./language-support";
import { PROVIDERS } from "./shared";
import { useSttSelection } from "./use-selection";

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
import { MissingSetupLabel } from "~/settings/ai/shared/provider-setup-label";
import {
  type ModelPickerVariant,
  ModelSettingsShell,
} from "~/settings/ai/shared/settings-shell";
import { useConfigValue } from "~/shared/config";

export function SttModelPicker({ variant }: { variant: ModelPickerVariant }) {
  // Onboarding has no working model to keep while a download runs, and saving
  // the choice right away lets it resume the download after a restart.
  return (
    <SttSettingsProvider selectOnDownload={variant === "embedded"}>
      <SttPickerBody variant={variant} />
    </SttSettingsProvider>
  );
}

function SttPickerBody({ variant }: { variant: ModelPickerVariant }) {
  const { t, i18n } = useLingui();
  const catalog = useSttCatalog();
  const selection = useSttSelection(catalog);
  const languages = useTranscriptionLanguages();
  const localModelPath = useConfigValue("local_stt_model_path")?.trim() ?? "";
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<SttFilters>(NO_STT_FILTERS);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const entries: SttEntry[] = PROVIDERS.filter(
    (provider) => !catalog.providers[provider.id].unsupportedPlatform,
  ).map((provider) => {
    const status = catalog.providers[provider.id];
    return {
      provider,
      status,
      models: sttEntryModels(
        provider.id,
        status,
        selection.lastUsedModel(provider.id),
      ),
    };
  });
  const languageSupport = useSttLanguageSupport(
    entries.flatMap(({ provider, models }) =>
      models.map((model) => ({
        provider: provider.id,
        model: model.id,
        mode: model.mode,
        modelLanguages: model.languages,
      })),
    ),
  );
  const visibleEntries = browseSttEntries(
    entries,
    search,
    filters,
    (provider, model) =>
      languageSupport.get(languageSupportKey(provider, model)),
  );
  const current = selection.current;
  const focused =
    visibleEntries.find(({ provider }) => provider.id === focusedId) ??
    visibleEntries.find(({ provider }) => provider.id === current?.provider) ??
    visibleEntries[0];
  const currentEntry = current
    ? entries.find(({ provider }) => provider.id === current.provider)
    : undefined;
  const currentModel = current
    ? currentEntry?.models.find(({ id }) => id === current.model)
    : undefined;
  const filtering = hasActiveSttFilters(search, filters);
  const visibleModelCount = visibleEntries.reduce(
    (count, entry) => count + entry.models.length,
    0,
  );

  const toListItem = (entry: SttEntry): ProviderListItem => ({
    id: entry.provider.id,
    name: providerDisplayName(entry.provider, i18n),
    icon: entry.provider.icon,
    ...describeSttProvider(
      entry,
      entry.provider.id === current?.provider,
      localModelPath,
      i18n,
    ),
  });
  const groups = (
    [
      ["local", t`On this computer`],
      ["cloud", t`Cloud · your key`],
      ["self_hosted", t`Self-hosted`],
    ] as const satisfies ReadonlyArray<readonly [SttProviderGroup, string]>
  ).flatMap(([group, label]) => {
    const items = visibleEntries
      .filter(({ provider }) => sttProviderGroup(provider.id) === group)
      .map(toListItem);
    return items.length > 0
      ? [{ id: group, label, items, collapsible: group === "cloud" }]
      : [];
  });

  const setWhere = (where: SttFilters["where"]) =>
    setFilters((value) => ({ ...value, where }));
  const toggleMode = (mode: NonNullable<SttFilters["mode"]>) =>
    setFilters((value) => ({
      ...value,
      mode: value.mode === mode ? null : mode,
    }));

  return (
    <>
      {selection.persistDefault}
      <ModelSettingsShell
        variant={variant}
        title={<Trans>Transcription</Trans>}
        subtitle={<Trans>Where and how your meetings become text.</Trans>}
        search={search}
        onSearchChange={setSearch}
        inUse={
          <SttInUseBar
            current={current}
            displayName={currentModel?.displayName}
            mode={currentModel?.mode}
            isDeprecated={currentModel?.isDeprecated ?? false}
            languages={languages}
            support={
              current
                ? languageSupport.get(
                    languageSupportKey(current.provider, current.model),
                  )
                : undefined
            }
            pendingDownload={selection.pendingSelection}
          />
        }
        filters={
          <FilterBar
            label={t`Filter providers and models`}
            summary={
              <Plural
                value={visibleModelCount}
                one="# model"
                other="# models"
              />
            }
          >
            <FilterGroup label={t`Where it runs`}>
              {(
                [
                  ["all", t`All`],
                  ["local", t`On this computer`],
                  ["cloud", t`Cloud`],
                  ["self_hosted", t`Self-hosted`],
                ] as const
              ).map(([where, label]) => (
                <FilterChip
                  key={where}
                  pressed={filters.where === where}
                  onClick={() => setWhere(where)}
                >
                  {label}
                </FilterChip>
              ))}
            </FilterGroup>
            <FilterDivider />
            <FilterGroup label={t`When it transcribes`}>
              <FilterChip
                pressed={filters.mode === "live"}
                onClick={() => toggleMode("live")}
              >
                <Trans>Live</Trans>
              </FilterChip>
              <FilterChip
                pressed={filters.mode === "batch"}
                onClick={() => toggleMode("batch")}
              >
                <Trans>After recording</Trans>
              </FilterChip>
            </FilterGroup>
            {languages.length > 0 ? (
              <>
                <FilterDivider />
                <FilterChip
                  pressed={filters.transcribesMyLanguages}
                  icon={
                    filters.transcribesMyLanguages ? (
                      <Check className="size-3" aria-hidden />
                    ) : undefined
                  }
                  onClick={() =>
                    setFilters((value) => ({
                      ...value,
                      transcribesMyLanguages: !value.transcribesMyLanguages,
                    }))
                  }
                >
                  <Trans>
                    Transcribes {formatLanguageList(languages, i18n)}
                  </Trans>
                </FilterChip>
              </>
            ) : null}
          </FilterBar>
        }
        isEmpty={visibleEntries.length === 0}
        onClearFilters={() => {
          setSearch("");
          setFilters(NO_STT_FILTERS);
        }}
        list={
          <ProviderList
            label={t`Transcription providers`}
            groups={groups}
            focusedId={focused?.provider.id}
            onFocus={setFocusedId}
            expandAll={filtering}
          />
        }
        detail={
          focused ? (
            <SttProviderDetail
              key={focused.provider.id}
              entry={focused}
              current={current}
              pendingDownload={selection.pendingSelection}
              freeformModel={selection.lastUsedModel(focused.provider.id)}
              languages={languages}
              languageSupport={languageSupport}
              promptToSelect={variant === "page"}
              onSelect={selection.select}
            />
          ) : null
        }
      />
    </>
  );
}

function describeSttProvider(
  { provider, status }: SttEntry,
  inUse: boolean,
  localModelPath: string,
  i18n: I18n,
): Pick<ProviderListItem, "subtitle" | "status" | "statusLabel"> {
  const setup = status.setup;
  const modelCount = status.models.length;
  const downloadedCount = status.models.filter(
    (model) => model.isDownloaded,
  ).length;
  const subtitle =
    setup.kind === "checking" ? (
      <Trans>Checking…</Trans>
    ) : setup.kind === "rejected" ? (
      <Trans>Key rejected</Trans>
    ) : setup.kind === "unavailable" ? (
      <Trans>Not available on this computer</Trans>
    ) : setup.kind === "missing" ? (
      <MissingSetupLabel fields={setup.fields} />
    ) : provider.id === "apple_speech" ? (
      <Trans>Built into macOS</Trans>
    ) : provider.id === "local_file" ? (
      (localModelPath.split(/[/\\]/).filter(Boolean).pop() ?? (
        <Trans>A whisper.cpp file from your disk</Trans>
      ))
    ) : provider.id === "custom" || provider.id === "nvidia" ? (
      <Trans>Uses the model ID you enter</Trans>
    ) : provider.id === "soniqo" || provider.id === "gguf" ? (
      <Trans>
        <Plural value={modelCount} one="# model" other="# models" /> ·{" "}
        {downloadedCount} downloaded
      </Trans>
    ) : (
      <Plural value={modelCount} one="# model" other="# models" />
    );

  if (inUse && setup.kind === "ready") {
    return { subtitle, status: "in_use" };
  }

  switch (setup.kind) {
    case "ready":
      return {
        subtitle,
        status: "connected",
        statusLabel:
          sttProviderGroup(provider.id) === "local"
            ? i18n._(msg`Available`)
            : usesDeferredProviderAuthentication("stt", provider.id)
              ? i18n._(msg`Saved`)
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
