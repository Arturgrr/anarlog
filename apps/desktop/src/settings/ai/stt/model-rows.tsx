import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { platform } from "@tauri-apps/plugin-os";
import { useState } from "react";

import {
  commands as localSttCommands,
  type LocalModel,
} from "@anlg/plugin-local-stt";
import { commands as openerCommands } from "@anlg/plugin-opener2";
import {
  ArrowSquareOut,
  Check,
  CircleNotch,
  DownloadSimple,
  FolderOpen,
  Trash,
  Warning,
} from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { cn } from "@anlg/utils";

import type { SttMode, SttModelEntry } from "./catalog";
import { useSttSettings } from "./context";
import { formatLanguageList, type LanguageSupport } from "./language-support";
import {
  displayModelLabel,
  formatDownloadProgress,
  formatModelSize,
  sttModelQueries,
} from "./shared";

import { useNotifications } from "~/contexts/notifications";
import { Chip } from "~/settings/ai/shared/chip";
import { ModelOption } from "~/settings/ai/shared/model-options";
import { DestructiveConfirmationDialog } from "~/shared/ui/destructive-confirmation-dialog";
import {
  canAppleSpeechTranscribe,
  isSupportedLocalSttModel,
  modelCoversLanguages,
} from "~/stt/capabilities";
import type { SttModelLicense } from "~/stt/gguf";

export function ModeChip({ mode }: { mode: SttMode }) {
  const { t } = useLingui();
  return mode === "live" ? (
    <Chip title={t`Can transcribe while the meeting is happening.`}>
      <Trans>Live</Trans>
    </Chip>
  ) : (
    <Chip title={t`Runs after the recording finishes, not during the meeting.`}>
      <Trans>After recording</Trans>
    </Chip>
  );
}

export function SttModelRow({
  provider,
  model,
  checked,
  tabbable,
  selectable,
  support,
  languages,
  willBeUsedAfterDownload,
  onSelect,
}: {
  provider: string;
  model: SttModelEntry;
  checked: boolean;
  tabbable: boolean;
  selectable: boolean;
  support: LanguageSupport | undefined;
  languages: readonly string[];
  willBeUsedAfterDownload: boolean;
  onSelect: () => void;
}) {
  const label = displayModelLabel(model.id, model.displayName);
  const isLocal = isSupportedLocalSttModel(model.id);

  return (
    <ModelOption
      name={label}
      checked={checked}
      disabled={!selectable || !model.isDownloaded}
      tabbable={tabbable}
      onSelect={onSelect}
      chips={
        <>
          <ModeChip mode={model.mode} />
          {model.isDeprecated ? (
            <Chip>
              <Trans>Deprecated</Trans>
            </Chip>
          ) : null}
          {model.recommended === "device" ? (
            <Chip emphasis>
              <Trans>Best for this Mac</Trans>
            </Chip>
          ) : model.recommended === "languages" ? (
            <Chip emphasis>
              <Trans>Best for your languages</Trans>
            </Chip>
          ) : null}
        </>
      }
      description={model.description}
      details={
        <>
          {model.languages ? (
            <CatalogModelFacts model={model} languages={languages} />
          ) : null}
          {model.languages && support?.supported ? null : (
            <LanguageSupportLine
              model={model.id}
              support={support}
              languages={languages}
            />
          )}
          {willBeUsedAfterDownload ? (
            <span className="text-muted-foreground text-xs">
              <Trans>
                Librelog switches to this model when the download finishes.
              </Trans>
            </span>
          ) : null}
        </>
      }
      aside={
        isLocal ? (
          <LocalModelActions
            provider={provider}
            model={model.id as LocalModel}
            label={label}
            isDownloaded={model.isDownloaded}
            sizeBytes={model.sizeBytes}
          />
        ) : undefined
      }
      footer={
        model.license ? <LicenseNote license={model.license} /> : undefined
      }
    />
  );
}

function CatalogModelFacts({
  model,
  languages,
}: {
  model: SttModelEntry;
  languages: readonly string[];
}) {
  const { i18n } = useLingui();
  const modelLanguages = model.languages ?? [];
  const covered =
    languages.length > 0 && modelCoversLanguages(modelLanguages, languages);

  return (
    <span className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
      {covered ? (
        <span className="text-foreground flex items-center gap-1 font-medium">
          <Check className="size-3.5 shrink-0" aria-hidden />
          {formatLanguageList(languages, i18n)}
          <span aria-hidden className="text-faint font-normal">
            ·
          </span>
        </span>
      ) : null}
      <span>
        {modelLanguages.includes("*") ? (
          <Trans>Multilingual</Trans>
        ) : (
          <Plural
            value={modelLanguages.length}
            one="# language"
            other="# languages"
          />
        )}
      </span>
      {model.timestamps ? (
        <>
          <span aria-hidden className="text-faint">
            ·
          </span>
          <span>
            {model.timestamps === "word" ? (
              <Trans>Word timing</Trans>
            ) : model.timestamps === "segment" ? (
              <Trans>Segment timing</Trans>
            ) : (
              <Trans>No timing</Trans>
            )}
          </span>
        </>
      ) : null}
    </span>
  );
}

function LicenseNote({ license }: { license: SttModelLicense }) {
  return (
    <div className="text-faint flex flex-col gap-0.5 text-xs">
      <span>
        <Trans>
          License:{" "}
          <a
            href={license.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground inline-flex items-center gap-1 hover:underline"
          >
            {license.name}
            <ArrowSquareOut size={12} aria-hidden />
          </a>
        </Trans>
      </span>
      {license.attribution ? <span>{license.attribution}</span> : null}
    </div>
  );
}

export function LanguageSupportLine({
  model,
  support,
  languages,
}: {
  model: string;
  support: LanguageSupport | undefined;
  languages: readonly string[];
}) {
  const { i18n } = useLingui();

  if (!support || languages.length === 0) {
    return null;
  }

  if (support.supported) {
    return (
      <span className="flex items-center gap-1.5 text-xs">
        <Check className="size-3.5 shrink-0" aria-hidden />
        <Trans>Transcribes {formatLanguageList(languages, i18n)}</Trans>
      </span>
    );
  }

  const appleSettingsLanguages =
    model === "apple-speech"
      ? support.unsupportedLanguages.filter(canAppleSpeechTranscribe)
      : [];

  return (
    <span className="text-muted-foreground flex items-start gap-1.5 text-xs">
      <Warning className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        {appleSettingsLanguages.length > 0 ? (
          <Trans>
            Add {formatLanguageList(appleSettingsLanguages, i18n)} in System
            Settings › General › Language & Region to use it.
          </Trans>
        ) : support.unsupportedLanguages.length > 0 ? (
          <Trans>
            Can’t transcribe{" "}
            {formatLanguageList(support.unsupportedLanguages, i18n)}.
          </Trans>
        ) : (
          <Trans>Can’t transcribe all your languages together.</Trans>
        )}
      </span>
    </span>
  );
}

function LocalModelActions({
  provider,
  model,
  label,
  isDownloaded,
  sizeBytes,
}: {
  provider: string;
  model: LocalModel;
  label: string;
  isDownloaded: boolean;
  sizeBytes?: number | null;
}) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const { activeDownloads } = useNotifications();
  const { startDownload, cancelDownload, queuedDownloads } = useSttSettings();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const download = activeDownloads.find((entry) => entry.model === model);
  const isDownloading = !!download || queuedDownloads.includes(model);
  const sizeLabel = formatModelSize(sizeBytes);

  const cancel = useMutation({ mutationFn: () => cancelDownload(model) });
  const showInFinder = useMutation({
    mutationFn: async () => {
      const result = String(model).startsWith("soniqo-")
        ? await localSttCommands.soniqoModelDir(model)
        : await localSttCommands.modelsDir();
      if (result.status === "error") {
        throw new Error(result.error);
      }
      await openerCommands.openPath(result.data, null);
    },
  });
  const deleteModel = useMutation({
    mutationFn: async () => {
      const result = await localSttCommands.deleteModel(model);
      if (result.status === "error") {
        throw new Error(result.error);
      }
    },
    onSuccess: async () => {
      setConfirmingDelete(false);
      await queryClient.invalidateQueries({
        queryKey: sttModelQueries.isDownloaded(model).queryKey,
      });
    },
  });
  const error = cancel.error ?? showInFinder.error ?? deleteModel.error;

  if (isDownloading) {
    const progress = download && !download.isStarting ? download.progress : 0;
    const progressLabel = formatDownloadProgress(progress);

    return (
      <>
        <span className="text-faint font-mono text-xs">
          {progressLabel ? (
            <Trans>Downloading · {progressLabel}</Trans>
          ) : (
            <Trans>Starting download…</Trans>
          )}
        </span>
        <DownloadProgressBar
          label={t`Downloading ${label}`}
          progress={progress}
          className="w-40"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          <Trans>Cancel download</Trans>
        </Button>
        {error ? <ActionError message={error.message} /> : null}
      </>
    );
  }

  if (!isDownloaded) {
    return (
      <>
        {sizeLabel ? (
          <span className="text-faint font-mono text-xs">{sizeLabel}</span>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t`Download ${label}`}
          onClick={() => startDownload(model, provider)}
        >
          <DownloadSimple className="size-3.5" aria-hidden />
          <Trans>Download</Trans>
        </Button>
        {error ? <ActionError message={error.message} /> : null}
      </>
    );
  }

  return (
    <>
      <span className="text-faint font-mono text-xs">
        {sizeLabel ? (
          <Trans>{sizeLabel} · downloaded</Trans>
        ) : (
          <Trans>Downloaded</Trans>
        )}
      </span>
      <div className="flex gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => showInFinder.mutate()}
        >
          <FolderOpen className="size-3.5" aria-hidden />
          {platform() === "macos" ? (
            <Trans>Show in Finder</Trans>
          ) : (
            <Trans>Show in folder</Trans>
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t`Delete ${label}`}
          onClick={() => setConfirmingDelete(true)}
        >
          {deleteModel.isPending ? (
            <CircleNotch className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Trash className="size-3.5" aria-hidden />
          )}
          <Trans>Delete</Trans>
        </Button>
      </div>
      {error ? <ActionError message={error.message} /> : null}
      <DestructiveConfirmationDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={<Trans>Delete {label}?</Trans>}
        description={
          <Trans>
            The model files are removed from this computer. You can download
            them again later.
          </Trans>
        }
        confirmLabel={<Trans>Delete model</Trans>}
        isPending={deleteModel.isPending}
        confirmVariant="default"
        onConfirm={() => deleteModel.mutate()}
      />
    </>
  );
}

export function DownloadProgressBar({
  label,
  progress,
  className,
}: {
  label: string;
  progress: number;
  className?: string;
}) {
  const value = Math.max(0, Math.min(100, progress));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className={cn(["bg-layer-2 h-1 overflow-hidden rounded-full", className])}
    >
      <div
        className="bg-foreground h-full transition-[width] duration-300"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function ActionError({ message }: { message: string }) {
  return (
    <span role="alert" className="text-danger max-w-48 text-right text-xs">
      {message}
    </span>
  );
}
