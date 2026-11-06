import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId, useState } from "react";

import {
  ArrowsCounterClockwise,
  CircleNotch,
  WarningCircle,
} from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { Input } from "@anlg/ui/components/ui/input";
import { Switch } from "@anlg/ui/components/ui/switch";
import { focusRingClassName } from "@anlg/ui/lib/focus-ring";
import { cn } from "@anlg/utils";

import type { LlmEntry } from "./browse";
import { llmModelReadsImages } from "./model-lists";

import {
  normalizeReasoningEffort,
  reasoningProviderOptions,
  type ReasoningEffort,
} from "~/ai/reasoning-effort";
import { Chip } from "~/settings/ai/shared/chip";
import type { ModelIgnoreReason } from "~/settings/ai/shared/list-common";
import { displayLlmModelId } from "~/settings/ai/shared/model-display";
import {
  ModelOption,
  ModelOptionList,
} from "~/settings/ai/shared/model-options";
import { DetailSection } from "~/settings/ai/shared/provider-detail";
import type { ProviderSetup } from "~/settings/ai/shared/provider-setup";
import { useSetSettingValue } from "~/settings/queries";
import { useConfigValue } from "~/shared/config";

export function LlmModels({
  entry,
  setup,
  isSubscription,
  providerName,
  checkedModel,
  filtering,
  onSelect,
}: {
  entry: LlmEntry;
  setup: ProviderSetup;
  isSubscription: boolean;
  providerName: string;
  checkedModel: string | undefined;
  filtering: boolean;
  onSelect: (model: string) => void;
}) {
  const { t, i18n } = useLingui();
  const [showIgnored, setShowIgnored] = useState(false);
  const { provider, list, models } = entry;
  const result = list?.result;
  const ignored = result?.ignored ?? [];
  const listedIds = new Set([
    ...(result?.models ?? []),
    ...ignored.map(({ id }) => id),
  ]);
  const unlistedCurrent =
    checkedModel && result && !listedIds.has(checkedModel)
      ? checkedModel
      : undefined;
  const rows = [
    ...(unlistedCurrent ? [{ id: unlistedCurrent, reasons: [] }] : []),
    ...models.map((id) => ({ id, reasons: [] as ModelIgnoreReason[] })),
    ...(showIgnored ? ignored : []),
  ];
  const tabbableModel =
    rows.find(({ id }) => id === checkedModel)?.id ?? rows[0]?.id;

  return (
    <DetailSection
      title={<Trans>Models</Trans>}
      actions={
        list ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={list.isFetching}
            onClick={list.refetch}
          >
            <ArrowsCounterClockwise
              className={cn(["size-3", list.isFetching && "animate-spin"])}
              aria-hidden
            />
            <Trans>Refresh list</Trans>
          </Button>
        ) : null
      }
    >
      {!list ? (
        <p className="text-muted-foreground text-xs">
          <UnavailableModelsMessage
            setup={setup}
            isSubscription={isSubscription}
            providerName={providerName}
          />
        </p>
      ) : list.isLoading ? (
        <p
          role="status"
          className="text-muted-foreground flex items-center gap-1.5 text-xs"
        >
          <CircleNotch className="size-3 animate-spin" aria-hidden />
          <Trans>Loading models…</Trans>
        </p>
      ) : (
        <>
          {list.error ? (
            <p
              role="alert"
              className="text-danger flex items-start gap-1.5 text-xs"
            >
              <WarningCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">
                <Trans>Couldn’t load the model list: {list.error}</Trans>
              </span>
            </p>
          ) : null}
          {rows.length > 0 ? (
            <div className="max-h-[440px] overflow-y-auto pr-1">
              <ModelOptionList label={t`Models`}>
                {rows.map(({ id, reasons }) => {
                  const label = displayLlmModelId(id);
                  const readsImages = llmModelReadsImages(
                    provider.id,
                    id,
                    result?.metadata[id],
                  );
                  return (
                    <ModelOption
                      key={`${reasons.length > 0 ? "ignored:" : ""}${id}`}
                      compact
                      name={label}
                      checked={id === checkedModel}
                      tabbable={id === tabbableModel}
                      onSelect={() => onSelect(id)}
                      chips={
                        <>
                          {readsImages ? (
                            <Chip>
                              <Trans>Reads images</Trans>
                            </Chip>
                          ) : null}
                          {reasons.includes("old_model") ? (
                            <Chip>
                              <Trans>Deprecated</Trans>
                            </Chip>
                          ) : null}
                        </>
                      }
                      description={
                        reasons.length > 0
                          ? reasons
                              .map((reason) => formatIgnoreReason(reason, i18n))
                              .join(" · ")
                          : id === unlistedCurrent
                            ? t`Not in this provider’s list`
                            : undefined
                      }
                      details={
                        label !== id ? (
                          <span className="text-faint font-mono text-xs break-all">
                            {id}
                          </span>
                        ) : undefined
                      }
                    />
                  );
                })}
              </ModelOptionList>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              {filtering && (result?.models.length ?? 0) > 0 ? (
                <Trans>No models match your search and filters.</Trans>
              ) : ignored.length > 0 ? (
                <Trans>
                  No models ready to use. Show ignored models to pick one
                  anyway.
                </Trans>
              ) : (
                <Trans>No models available.</Trans>
              )}
            </p>
          )}
          {filtering && (result?.models.length ?? 0) > models.length ? (
            <p className="text-faint text-xs">
              <Trans>
                Showing {models.length} of {result?.models.length ?? 0} models.
              </Trans>
            </p>
          ) : null}
          {ignored.length > 0 ? (
            <IgnoredModelsToggle
              checked={showIgnored}
              count={ignored.length}
              onCheckedChange={setShowIgnored}
            />
          ) : null}
          <CustomModelForm key={checkedModel ?? ""} onSubmit={onSelect} />
        </>
      )}
    </DetailSection>
  );
}

function UnavailableModelsMessage({
  setup,
  isSubscription,
  providerName,
}: {
  setup: ProviderSetup;
  isSubscription: boolean;
  providerName: string;
}) {
  switch (setup.kind) {
    case "checking":
      return <Trans>Checking the connection…</Trans>;
    case "rejected":
      return <Trans>The key was rejected. Check it above.</Trans>;
    case "stopped":
      return <Trans>Start {providerName} to see its models.</Trans>;
    case "missing":
      return isSubscription ? (
        <Trans>Sign in to see the models in your plan.</Trans>
      ) : (
        <Trans>Finish the connection above to see the models.</Trans>
      );
    default:
      return <Trans>No models available.</Trans>;
  }
}

function IgnoredModelsToggle({
  checked,
  count,
  onCheckedChange,
}: {
  checked: boolean;
  count: number;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();

  return (
    <div className="flex items-center gap-2 text-xs">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
      <label htmlFor={id} className="text-muted-foreground cursor-pointer">
        <Trans>Show ignored models</Trans>{" "}
        <span className="text-faint font-mono">{count}</span>
      </label>
    </div>
  );
}

function CustomModelForm({ onSubmit }: { onSubmit: (model: string) => void }) {
  const { t } = useLingui();
  const inputId = useId();

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const model = String(
          new FormData(event.currentTarget).get("model") ?? "",
        ).trim();
        if (model) {
          onSubmit(model);
        }
      }}
    >
      <label htmlFor={inputId} className="text-xs font-medium">
        <Trans>Use a model that isn’t listed</Trans>
      </label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          name="model"
          placeholder={t`Exact model ID, as the provider names it`}
          className="font-mono text-xs"
        />
        <Button type="submit" variant="outline">
          <Trans>Use model</Trans>
        </Button>
      </div>
    </form>
  );
}

export function ReasoningEffortControl({
  providerId,
  modelId,
}: {
  providerId: string;
  modelId: string;
}) {
  const { t } = useLingui();
  const effort = normalizeReasoningEffort(
    useConfigValue("current_llm_reasoning_effort"),
  );
  const setEffort = useSetSettingValue("current_llm_reasoning_effort");
  const headingId = useId();

  if (!reasoningProviderOptions(providerId, modelId, "medium")) {
    return null;
  }

  const options: Array<[ReasoningEffort, string]> = [
    ["default", t`Default`],
    ["low", t`Low`],
    ["medium", t`Medium`],
    ["high", t`High`],
  ];

  return (
    <div className="border-border flex flex-wrap items-center gap-3 border-t pt-4">
      <div className="flex min-w-56 flex-1 flex-col gap-0.5">
        <span id={headingId} className="font-medium">
          <Trans>Reasoning effort</Trans>
        </span>
        <span className="text-faint text-xs">
          <Trans>
            How much the model thinks before answering. Default leaves it to the
            provider.
          </Trans>
        </span>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={headingId}
        className="bg-layer-1 inline-flex gap-0.5 rounded-md p-0.5 shadow-[inset_0_0_0_0.5px_var(--color-border)]"
      >
        {options.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={effort === value}
            onClick={() => setEffort(value)}
            className={cn([
              focusRingClassName,
              "h-6 rounded-sm px-3 text-xs font-medium",
              effort === value
                ? "bg-layer-3 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            ])}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function reasoningEffortLabel(effort: ReasoningEffort, i18n: I18n) {
  switch (effort) {
    case "low":
      return i18n._(msg`Low reasoning`);
    case "medium":
      return i18n._(msg`Medium reasoning`);
    case "high":
      return i18n._(msg`High reasoning`);
    default:
      return null;
  }
}

function formatIgnoreReason(reason: ModelIgnoreReason, i18n: I18n): string {
  switch (reason) {
    case "common_keyword":
      return i18n._(msg`Contains common ignore keyword`);
    case "old_model":
      return i18n._(msg`Old or deprecated model`);
    case "date_snapshot":
      return i18n._(msg`Date-specific snapshot`);
    case "no_tool":
      return i18n._(msg`No tool support`);
    case "no_text_input":
      return i18n._(msg`No text input support`);
    case "no_completion":
      return i18n._(msg`No completion support`);
    case "not_llm":
      return i18n._(msg`Not an LLM type`);
    case "not_chat_model":
      return i18n._(msg`Not a chat model`);
    case "context_too_small":
      return i18n._(msg`Context length too small`);
  }
}
