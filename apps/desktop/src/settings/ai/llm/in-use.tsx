import { Trans, useLingui } from "@lingui/react/macro";

import { useConnectionHealth } from "./health";
import { llmModelReadsImages } from "./model-lists";
import { reasoningEffortLabel } from "./models";
import { PROVIDERS } from "./shared";

import {
  normalizeReasoningEffort,
  reasoningProviderOptions,
} from "~/ai/reasoning-effort";
import { Chip } from "~/settings/ai/shared/chip";
import { type HealthDisplay, InUseBar } from "~/settings/ai/shared/in-use-bar";
import type { ModelMetadata } from "~/settings/ai/shared/list-common";
import { displayLlmModelId } from "~/settings/ai/shared/model-display";
import { providerDisplayName } from "~/settings/ai/shared/provider-labels";
import { useConfigValue } from "~/shared/config";

export function LlmInUseBar({
  current,
  isPending,
  metadata,
  showMissingModelWarning,
}: {
  current: { provider: string; model: string } | null;
  isPending: boolean;
  metadata: ModelMetadata | undefined;
  showMissingModelWarning: boolean;
}) {
  const { t, i18n } = useLingui();
  const health = useConnectionHealth();
  const effort = normalizeReasoningEffort(
    useConfigValue("current_llm_reasoning_effort"),
  );
  const provider = current
    ? PROVIDERS.find(({ id }) => id === current.provider)
    : undefined;
  const effortLabel =
    current && reasoningProviderOptions(current.provider, current.model, effort)
      ? reasoningEffortLabel(effort, i18n)
      : null;
  const healthDisplay: HealthDisplay | null =
    !current || isPending
      ? null
      : health.status === "pending"
        ? { kind: "checking", message: t`Checking the connection…` }
        : health.status === "error"
          ? { kind: "error", message: health.message }
          : health.status === "success"
            ? { kind: "ready", message: t`Connection verified` }
            : null;

  return (
    <InUseBar
      icon={provider?.icon}
      model={current ? displayLlmModelId(current.model) : undefined}
      provider={provider ? providerDisplayName(provider, i18n) : undefined}
      emptyMessage={
        showMissingModelWarning ? (
          <Trans>Choose a language model for summaries and chat.</Trans>
        ) : (
          <Trans>No model selected</Trans>
        )
      }
      chips={
        current ? (
          <>
            {llmModelReadsImages(current.provider, current.model, metadata) ? (
              <Chip>
                <Trans>Reads images</Trans>
              </Chip>
            ) : null}
            {effortLabel ? <Chip>{effortLabel}</Chip> : null}
          </>
        ) : undefined
      }
      health={healthDisplay}
    />
  );
}
