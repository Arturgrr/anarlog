import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";

import { Globe } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";

import type { SttMode } from "./catalog";
import { useConnectionHealth } from "./health";
import { formatLanguageList, type LanguageSupport } from "./language-support";
import { ModeChip } from "./model-rows";
import { displayModelLabel, formatDownloadProgress, PROVIDERS } from "./shared";

import { useNotifications } from "~/contexts/notifications";
import { Chip } from "~/settings/ai/shared/chip";
import {
  type HealthDisplay,
  InlineNotice,
  InUseBar,
} from "~/settings/ai/shared/in-use-bar";
import { providerDisplayName } from "~/settings/ai/shared/provider-labels";
import { useTabs } from "~/store/zustand/tabs";
import { canAppleSpeechTranscribe } from "~/stt/capabilities";

export function SttInUseBar({
  current,
  displayName,
  mode,
  isDeprecated,
  languages,
  support,
  pendingDownload,
}: {
  current: { provider: string; model: string } | null;
  displayName?: string;
  mode?: SttMode;
  isDeprecated: boolean;
  languages: readonly string[];
  support: LanguageSupport | undefined;
  pendingDownload: { provider: string; model: string } | null;
}) {
  const { i18n } = useLingui();
  const health = useConnectionHealth();
  const { activeDownloads } = useNotifications();
  const openNew = useTabs((state) => state.openNew);
  const provider = current
    ? PROVIDERS.find(({ id }) => id === current.provider)
    : undefined;
  const modelLabel = current
    ? displayModelLabel(current.model, displayName)
    : undefined;
  const healthDisplay: HealthDisplay | null = !current
    ? null
    : health.status === "pending"
      ? { kind: "checking", message: health.message }
      : health.status === "error"
        ? { kind: "error", message: health.message }
        : health.status === "success"
          ? { kind: "ready" }
          : health.message
            ? { kind: "info", message: health.message }
            : null;
  const languageWarning =
    current && modelLabel && support && !support.supported
      ? describeLanguageIssue(current.model, modelLabel, support, i18n)
      : null;
  const pendingProgress = pendingDownload
    ? activeDownloads.find(({ model }) => model === pendingDownload.model)
    : undefined;
  const pendingLabel = pendingDownload
    ? displayModelLabel(pendingDownload.model)
    : undefined;
  const pendingPercent = formatDownloadProgress(pendingProgress?.progress);

  return (
    <InUseBar
      icon={provider?.icon}
      model={modelLabel}
      provider={provider ? providerDisplayName(provider, i18n) : undefined}
      emptyMessage={
        <Trans>Choose a transcription model to start listening.</Trans>
      }
      chips={
        current && mode ? (
          <>
            <ModeChip mode={mode} />
            {isDeprecated ? (
              <Chip>
                <Trans>Deprecated</Trans>
              </Chip>
            ) : null}
          </>
        ) : undefined
      }
      details={
        <div className="text-muted-foreground flex flex-wrap items-center gap-2">
          <Globe className="size-3.5 shrink-0" aria-hidden />
          <span>
            {languages.length > 0 ? (
              formatLanguageList(languages, i18n)
            ) : (
              <Trans>No spoken languages set</Trans>
            )}
          </span>
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            onClick={() => openNew({ type: "settings", state: { tab: "app" } })}
          >
            <Trans>Edit languages</Trans>
          </Button>
        </div>
      }
      health={healthDisplay}
      notice={
        <>
          {pendingDownload && pendingLabel ? (
            <InlineNotice>
              {pendingPercent ? (
                <Trans>
                  Switching to {pendingLabel} when its download finishes (
                  {pendingPercent}).
                </Trans>
              ) : (
                <Trans>
                  Switching to {pendingLabel} when its download finishes.
                </Trans>
              )}
            </InlineNotice>
          ) : null}
          {languageWarning && healthDisplay?.kind !== "error" ? (
            <InlineNotice>{languageWarning}</InlineNotice>
          ) : null}
        </>
      }
    />
  );
}

function describeLanguageIssue(
  modelId: string,
  model: string,
  support: LanguageSupport,
  i18n: I18n,
) {
  // Apple Speech is limited to languages added in System Settings, so a language it
  // supports needs a different fix than one it cannot transcribe at all.
  const needsSystemSettings =
    modelId === "apple-speech"
      ? support.unsupportedLanguages.filter(canAppleSpeechTranscribe)
      : [];

  if (needsSystemSettings.length > 0) {
    return i18n._(
      msg`Add ${formatLanguageList(needsSystemSettings, i18n)} in System Settings > General > Language & Region to transcribe with ${model}, or choose another model.`,
    );
  }
  if (support.unsupportedLanguages.length > 0) {
    return i18n._(
      msg`${model} can't transcribe ${formatLanguageList(support.unsupportedLanguages, i18n)}. Try another model or change your spoken languages.`,
    );
  }
  return i18n._(
    msg`${model} can't transcribe all selected languages together. Try another model or use fewer spoken languages.`,
  );
}
