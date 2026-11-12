import { Trans, useLingui } from "@lingui/react/macro";
import { useId } from "react";

import { Input } from "@anlg/ui/components/ui/input";

import type { SttEntry } from "./browse";
import { usesFreeformSttModel } from "./catalog";
import { languageSupportKey, type LanguageSupport } from "./language-support";
import { LocalFileModel } from "./local-file-model";
import { LanguageSupportLine, ModeChip, SttModelRow } from "./model-rows";
import { STT_PROVIDER_CONTEXT } from "./provider-context";
import { SpeechEngineSection } from "./speech-engine";

import { ProviderConnectionForm, StyledStreamdown } from "~/settings/ai/shared";
import {
  ModelOption,
  ModelOptionList,
} from "~/settings/ai/shared/model-options";
import {
  DetailSection,
  ProviderBadgeChip,
  ProviderDetailHeader,
} from "~/settings/ai/shared/provider-detail";
import { providerDisplayName } from "~/settings/ai/shared/provider-labels";
import { useConfigValue } from "~/shared/config";

export function SttProviderDetail({
  entry,
  current,
  pendingDownload,
  freeformModel,
  languages,
  languageSupport,
  promptToSelect,
  onSelect,
}: {
  entry: SttEntry;
  current: { provider: string; model: string } | null;
  pendingDownload: { provider: string; model: string } | null;
  freeformModel: string;
  languages: readonly string[];
  languageSupport: Map<string, LanguageSupport>;
  promptToSelect: boolean;
  onSelect: (provider: string, model: string) => void;
}) {
  const { i18n, t } = useLingui();
  const { provider, status, models } = entry;
  const context = STT_PROVIDER_CONTEXT[provider.id];
  const isCurrentProvider = current?.provider === provider.id;
  const selectable = status.configured;
  const checkedModel = isCurrentProvider ? current?.model : undefined;
  const tabbableModel =
    models.find((model) => model.id === checkedModel && model.isDownloaded)
      ?.id ??
    (selectable ? models.find((model) => model.isDownloaded)?.id : undefined);

  return (
    <>
      <ProviderDetailHeader
        icon={provider.icon}
        name={providerDisplayName(provider, i18n)}
        badges={
          provider.badge ? <ProviderBadgeChip badge={provider.badge} /> : null
        }
      >
        {context ? (
          <StyledStreamdown>{i18n._(context)}</StyledStreamdown>
        ) : null}
      </ProviderDetailHeader>

      {"builtIn" in provider ? null : (
        <DetailSection title={<Trans>Connection</Trans>}>
          <ProviderConnectionForm
            key={provider.id}
            config={provider}
            providerType="stt"
            currentProvider={current?.provider}
            promptToSelect={promptToSelect}
          />
        </DetailSection>
      )}

      <DetailSection title={<Trans>Models</Trans>}>
        {status.setup.kind === "unavailable" ? (
          <p className="text-muted-foreground">
            <Trans>Not available on this computer.</Trans>
          </p>
        ) : null}
        {!selectable && !("builtIn" in provider) ? (
          <p className="text-muted-foreground text-xs">
            {status.setup.kind === "checking" ? (
              <Trans>Checking the connection…</Trans>
            ) : (
              <Trans>Finish the connection above to use these models.</Trans>
            )}
          </p>
        ) : null}

        {provider.id === "local_file" ? (
          <LocalFileModels
            selectable={selectable}
            checked={checkedModel === "local-file"}
            entry={entry}
            languages={languages}
            support={languageSupport.get(
              languageSupportKey(provider.id, "local-file"),
            )}
            onSelect={() => onSelect(provider.id, "local-file")}
          />
        ) : usesFreeformSttModel(provider.id) ? (
          <FreeformModel
            key={`${provider.id}:${freeformModel}`}
            initialModel={freeformModel}
            disabled={!selectable}
            isCurrent={isCurrentProvider && checkedModel === freeformModel}
            onCommit={(model) => onSelect(provider.id, model)}
          />
        ) : models.length > 0 ? (
          <ModelOptionList label={t`Models`}>
            {models.map((model) => (
              <SttModelRow
                key={model.id}
                provider={provider.id}
                model={model}
                checked={model.id === checkedModel}
                tabbable={model.id === tabbableModel}
                selectable={selectable}
                support={languageSupport.get(
                  languageSupportKey(provider.id, model.id),
                )}
                languages={languages}
                willBeUsedAfterDownload={
                  pendingDownload?.provider === provider.id &&
                  pendingDownload.model === model.id
                }
                onSelect={() => onSelect(provider.id, model.id)}
              />
            ))}
          </ModelOptionList>
        ) : null}
        {models.some(
          (model) => model.timestamps && model.timestamps !== "word",
        ) ? (
          <p className="text-faint text-xs">
            <Trans>
              Models without word timing make speaker separation after meetings
              less precise.
            </Trans>
          </p>
        ) : null}
      </DetailSection>

      {selectable &&
      (provider.id === "gguf" || provider.id === "local_file") ? (
        <SpeechEngineSection />
      ) : null}

      <p className="text-faint text-xs">
        <Trans>
          Live shows text while the meeting happens. After recording transcribes
          once the recording ends.
        </Trans>
      </p>
    </>
  );
}

function LocalFileModels({
  entry,
  selectable,
  checked,
  languages,
  support,
  onSelect,
}: {
  entry: SttEntry;
  selectable: boolean;
  checked: boolean;
  languages: readonly string[];
  support: LanguageSupport | undefined;
  onSelect: () => void;
}) {
  const { t } = useLingui();
  const modelPath = useConfigValue("local_stt_model_path")?.trim() ?? "";
  const fileName = modelPath.split(/[/\\]/).filter(Boolean).pop();
  const model = entry.models.find(({ id }) => id === "local-file");

  return (
    <div className="flex flex-col gap-3">
      {model && fileName ? (
        <ModelOptionList label={t`Models`}>
          <ModelOption
            name={fileName}
            checked={checked}
            disabled={!selectable}
            tabbable
            onSelect={onSelect}
            chips={<ModeChip mode={model.mode} />}
            details={
              <LanguageSupportLine
                model={model.id}
                support={support}
                languages={languages}
              />
            }
          />
        </ModelOptionList>
      ) : null}
      {selectable ? <LocalFileModel /> : null}
    </div>
  );
}

function FreeformModel({
  initialModel,
  disabled,
  isCurrent,
  onCommit,
}: {
  initialModel: string;
  disabled: boolean;
  isCurrent: boolean;
  onCommit: (model: string) => void;
}) {
  const { t } = useLingui();
  const inputId = useId();

  const commit = (value: string) => {
    const model = value.trim();
    if (model && !(isCurrent && model === initialModel)) {
      onCommit(model);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-xs font-medium">
        <Trans>Model ID</Trans>
      </label>
      <Input
        id={inputId}
        defaultValue={initialModel}
        disabled={disabled}
        placeholder={t`Enter a model identifier`}
        className="font-mono text-xs"
        onBlur={(event) => {
          if (event.currentTarget.value.trim() !== initialModel) {
            commit(event.currentTarget.value);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(event.currentTarget.value);
          }
        }}
      />
      <p className="text-faint text-xs">
        {isCurrent ? (
          <Trans>
            In use. Changes apply when you press Enter or leave the field.
          </Trans>
        ) : (
          <Trans>Press Enter to use this model ID.</Trans>
        )}
      </p>
    </div>
  );
}
