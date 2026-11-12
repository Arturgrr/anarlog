import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { platform } from "@tauri-apps/plugin-os";
import { useState } from "react";

import {
  commands,
  events,
  type LlmModel,
  type LlmModelEntry,
  type ServerState,
} from "@anlg/plugin-local-llm";
import { commands as openerCommands } from "@anlg/plugin-opener2";
import {
  CircleNotch,
  DownloadSimple,
  FolderOpen,
  Trash,
  WarningCircle,
} from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";

import { startBuiltinDownload } from "./builtin-downloads";

import { asLlmError, builtinErrorMessage } from "~/ai/builtin-fetch";
import { useNotifications } from "~/contexts/notifications";
import { Chip } from "~/settings/ai/shared/chip";
import { builtinQueries } from "~/settings/ai/shared/list-builtin";
import { displayLlmModelId } from "~/settings/ai/shared/model-display";
import {
  ModelOption,
  ModelOptionList,
} from "~/settings/ai/shared/model-options";
import { DetailSection } from "~/settings/ai/shared/provider-detail";
import { DownloadProgressBar, LicenseNote } from "~/settings/ai/stt/model-rows";
import {
  formatDownloadProgress,
  formatModelSize,
} from "~/settings/ai/stt/shared";
import { DestructiveConfirmationDialog } from "~/shared/ui/destructive-confirmation-dialog";
import { usePendingLlmSelection } from "~/store/zustand/pending-llm-selection";

const DESCRIPTIONS: Record<LlmModel, MessageDescriptor> = {
  "qwen3-4b": msg`Qwen's 4-billion-parameter model: good summaries at a size most Macs can run.`,
  "qwen3-8b": msg`Qwen's 8-billion-parameter model: better summaries, for Macs with 16 GB of memory or more.`,
  "granite-4.0-micro": msg`IBM's 3-billion-parameter model, which fits longer meetings into less memory.`,
  "ministral-3-8b": msg`Mistral AI's 8-billion-parameter multilingual model.`,
  "ministral-3-3b": msg`Mistral AI's 3-billion-parameter multilingual model, for Macs with less memory.`,
};

// About 150 spoken words a minute, plus room for the instructions and the
// summary itself.
function meetingMinutes(context: number) {
  return Math.max(0, Math.floor((context - 2048) / 200 / 5) * 5);
}

export function BuiltinModels({
  checkedModel,
  onSelect,
}: {
  checkedModel: string | undefined;
  onSelect: (model: string) => void;
}) {
  const { t, i18n } = useLingui();
  const queryClient = useQueryClient();
  const runtime = useQuery(builtinQueries.runtime());
  const models = useQuery({
    ...builtinQueries.models(),
    enabled: runtime.data?.available === true,
  });

  useMountEffect(() => {
    const unlisten = events.llmServerStateChanged.listen((event) => {
      queryClient.setQueryData(
        builtinQueries.server().queryKey,
        event.payload.state,
      );
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  });

  if (runtime.data && !runtime.data.available) {
    return (
      <DetailSection title={<Trans>Models</Trans>}>
        <p className="text-muted-foreground text-xs">
          {runtime.data.reason === "missing_binary" ? (
            <Trans>
              This build of Librelog doesn’t include the model server. The
              release for Macs with Apple silicon does.
            </Trans>
          ) : (
            <Trans>
              Built-in models run in Librelog for Macs with Apple silicon,
              downloaded from its website. This version can’t run them.
            </Trans>
          )}
        </p>
      </DetailSection>
    );
  }

  const entries = models.data ?? [];
  const tabbableModel =
    entries.find(({ id }) => id === checkedModel)?.id ??
    entries.find(({ downloaded }) => downloaded)?.id;

  return (
    <>
      <BuiltinServerStatus entries={entries} />
      <DetailSection
        title={<Trans>Models</Trans>}
        actions={<ShowModelsFolder />}
      >
        {models.isPending ? (
          <p
            role="status"
            className="text-muted-foreground flex items-center gap-1.5 text-xs"
          >
            <CircleNotch className="size-3 animate-spin" aria-hidden />
            <Trans>Loading models…</Trans>
          </p>
        ) : models.error ? (
          <p role="alert" className="text-danger text-xs">
            {models.error.message}
          </p>
        ) : (
          <ModelOptionList label={t`Built-in models`}>
            {entries.map((entry) => {
              const name = displayLlmModelId(entry.id);
              const { fit, context } = entry.admission;
              return (
                <ModelOption
                  key={entry.id}
                  name={name}
                  checked={entry.id === checkedModel}
                  disabled={!entry.downloaded || fit === "tooLarge"}
                  tabbable={entry.id === tabbableModel}
                  onSelect={() => onSelect(entry.id)}
                  chips={
                    <>
                      {entry.best ? (
                        <Chip emphasis>
                          <Trans>Best for this Mac</Trans>
                        </Chip>
                      ) : null}
                      <FitChip fit={fit} />
                    </>
                  }
                  description={i18n._(DESCRIPTIONS[entry.id])}
                  details={
                    context ? (
                      <span className="text-muted-foreground text-xs">
                        <Trans>
                          Reads about {meetingMinutes(context)} minutes of
                          meeting at once on this Mac
                        </Trans>
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        <Trans>
                          Needs about{" "}
                          {formatModelSize(entry.admission.estimateBytes)} of
                          memory.
                        </Trans>
                      </span>
                    )
                  }
                  aside={<BuiltinModelActions entry={entry} name={name} />}
                  footer={
                    <LicenseNote
                      license={entry.license}
                      sourceUrl={entry.sourceUrl}
                    />
                  }
                />
              );
            })}
          </ModelOptionList>
        )}
      </DetailSection>
    </>
  );
}

function FitChip({ fit }: { fit: LlmModelEntry["admission"]["fit"] }) {
  const { t } = useLingui();
  switch (fit) {
    case "fits":
      return (
        <Chip title={t`Uses at most half of this Mac’s memory.`}>
          <Trans>Fits</Trans>
        </Chip>
      );
    case "tight":
      return (
        <Chip
          title={t`Runs with a short context and leaves little memory for other apps.`}
        >
          <Trans>Tight</Trans>
        </Chip>
      );
    case "tooLarge":
      return (
        <Chip>
          <Trans>Too large for this Mac</Trans>
        </Chip>
      );
  }
}

function BuiltinServerStatus({ entries }: { entries: LlmModelEntry[] }) {
  const queryClient = useQueryClient();
  const server = useQuery(builtinQueries.server());
  const stop = useMutation({
    mutationFn: () => commands.stopServer(),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: builtinQueries.server().queryKey,
      }),
  });
  const state: ServerState = server.data ?? { status: "stopped" };
  const name =
    "model" in state
      ? (entries.find(({ id }) => id === state.model)?.displayName ??
        displayLlmModelId(state.model))
      : "";

  return (
    <DetailSection title={<Trans>Model server</Trans>}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground min-w-0 flex-1">
          {state.status === "stopped" ? (
            <Trans>
              Not running. It starts with the first summary or chat and stops
              after 5 idle minutes to free memory.
            </Trans>
          ) : state.status === "starting" ? (
            <Trans>Loading {name}…</Trans>
          ) : state.status === "ready" ? (
            <Trans>
              {name} is running with {Math.round(state.context / 1024)}K tokens
              of context.
            </Trans>
          ) : (
            <span role="alert" className="text-danger flex items-start gap-1.5">
              <WarningCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">
                {state.gaveUp ? (
                  <Trans>
                    {name} failed to start three times: {state.message}
                  </Trans>
                ) : (
                  state.message
                )}
              </span>
            </span>
          )}
        </span>
        {state.status === "ready" || state.status === "failed" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={stop.isPending}
            onClick={() => stop.mutate()}
          >
            {state.status === "ready" ? (
              <Trans>Stop</Trans>
            ) : (
              <Trans>Try again</Trans>
            )}
          </Button>
        ) : null}
      </div>
    </DetailSection>
  );
}

function ShowModelsFolder() {
  const open = useMutation({
    mutationFn: async () => {
      const result = await commands.modelsDir();
      if (result.status === "error") {
        throw new Error(builtinErrorMessage(asLlmError(result.error)));
      }
      await openerCommands.openPath(result.data, null);
    },
  });

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => open.mutate()}
    >
      <FolderOpen className="size-3.5" aria-hidden />
      {platform() === "macos" ? (
        <Trans>Show in Finder</Trans>
      ) : (
        <Trans>Show in folder</Trans>
      )}
    </Button>
  );
}

function BuiltinModelActions({
  entry,
  name,
}: {
  entry: LlmModelEntry;
  name: string;
}) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const { activeDownloads } = useNotifications();
  const pending = usePendingLlmSelection((state) => state.model);
  const failure = usePendingLlmSelection(
    (state) => state.failedDownloads[entry.id],
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const download = activeDownloads.find(({ model }) => model === entry.id);
  const sizeLabel = formatModelSize(entry.sizeBytes);

  const start = useMutation({
    mutationFn: () => startBuiltinDownload(entry.id),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: builtinQueries.models().queryKey,
      }),
  });
  const cancel = useMutation({
    mutationFn: async () => {
      const result = await commands.cancelDownload(entry.id);
      if (result.status === "error") {
        throw new Error(builtinErrorMessage(asLlmError(result.error)));
      }
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: builtinQueries.models().queryKey,
      }),
  });
  const remove = useMutation({
    mutationFn: async () => {
      const result = await commands.deleteModel(entry.id);
      if (result.status === "error") {
        throw new Error(builtinErrorMessage(asLlmError(result.error)));
      }
    },
    onSuccess: async () => {
      setConfirmingDelete(false);
      await queryClient.invalidateQueries({ queryKey: ["builtin-llm"] });
      await queryClient.invalidateQueries({ queryKey: ["models", "builtin"] });
    },
  });
  const error = start.error ?? cancel.error ?? remove.error;

  if (download || entry.downloading || start.isPending) {
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
          label={t`Downloading ${name}`}
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
        {pending === entry.id ? (
          <span className="text-muted-foreground max-w-48 text-right text-xs">
            <Trans>
              Librelog switches to this model when the download finishes.
            </Trans>
          </span>
        ) : null}
        {error ? <ActionError message={error.message} /> : null}
      </>
    );
  }

  if (!entry.downloaded) {
    return (
      <>
        {sizeLabel ? (
          <span className="text-faint font-mono text-xs">{sizeLabel}</span>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t`Download ${name}`}
          disabled={entry.admission.fit === "tooLarge"}
          onClick={() => start.mutate()}
        >
          <DownloadSimple className="size-3.5" aria-hidden />
          {failure ? <Trans>Resume download</Trans> : <Trans>Download</Trans>}
        </Button>
        {error || failure ? (
          <ActionError message={error?.message ?? failure ?? ""} />
        ) : null}
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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={t`Delete ${name}`}
        onClick={() => setConfirmingDelete(true)}
      >
        {remove.isPending ? (
          <CircleNotch className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Trash className="size-3.5" aria-hidden />
        )}
        <Trans>Delete</Trans>
      </Button>
      {error ? <ActionError message={error.message} /> : null}
      <DestructiveConfirmationDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={<Trans>Delete {name}?</Trans>}
        description={
          <Trans>
            The model file is removed from this computer. You can download it
            again later.
          </Trans>
        }
        confirmLabel={<Trans>Delete model</Trans>}
        isPending={remove.isPending}
        confirmVariant="default"
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

function ActionError({ message }: { message: string }) {
  return (
    <span role="alert" className="text-danger max-w-48 text-right text-xs">
      {message}
    </span>
  );
}
