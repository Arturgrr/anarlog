import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useId, useState } from "react";
import { useDebounceValue } from "usehooks-ts";

import {
  ArrowClockwise,
  ArrowCounterClockwise,
  Check,
  CircleNotch,
  Copy,
  MagnifyingGlass,
  Trash,
  Warning,
  X,
} from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@anlg/ui/components/ui/select";
import { cn } from "@anlg/utils";

import {
  useDictationHistory,
  useRetranscribe,
  useRetranscriptionModels,
} from "./queries";
import {
  clearDictations,
  deleteDictation,
  type DictationEntry,
  DICTATION_HISTORY_RETENTIONS,
  type DictationHistoryRetention,
  normalizeRetention,
  restoreDictationVersion,
} from "./store";

import { localizeExternalMessage } from "~/i18n/external-messages";
import { displayModelLabel } from "~/settings/ai/stt/shared";
import { SettingsPageTitle } from "~/settings/page-title";
import { useSetSettingValue } from "~/settings/queries";
import {
  SETTING_CONTROL_CLASS,
  SettingRow,
  SettingSwitchRow,
} from "~/settings/setting-row";
import { useConfigValue } from "~/shared/config";
import { DestructiveConfirmationDialog } from "~/shared/ui/destructive-confirmation-dialog";

const PAGE_SIZE = 50;

function formatTime(format: Intl.DateTimeFormat, value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : format.format(date);
}

export function SettingsDictationHistory() {
  const retention = normalizeRetention(
    useConfigValue("dictation_history_retention"),
  );
  const setRetention = useSetSettingValue("dictation_history_retention");
  const keepAudio = useConfigValue("dictation_history_keep_audio");
  const setKeepAudio = useSetSettingValue("dictation_history_keep_audio");

  return (
    <div className="flex flex-col gap-8">
      <SettingsPageTitle title={<Trans>Dictation history</Trans>} />
      <div className="flex flex-col gap-6">
        <p className="text-muted-foreground text-sm">
          <Trans>
            Each dictation is saved on this computer with its date, the app it
            went to, the model that transcribed it, and its text. Your history
            never leaves this computer.
          </Trans>
        </p>
        <RetentionRow value={retention} onChange={setRetention} />
        <SettingSwitchRow
          title={<Trans>Keep dictation audio</Trans>}
          description={
            <Trans>
              Also save each dictation's recording on this computer, so you can
              transcribe it again with another model. Audio is deleted with its
              dictation. Turning this off stops saving audio; audio already
              saved stays until its dictation is deleted or expires.
            </Trans>
          }
          checked={keepAudio}
          onChange={setKeepAudio}
          disabled={retention === "off"}
        />
        <History retention={retention} />
      </div>
    </div>
  );
}

function RetentionRow({
  value,
  onChange,
}: {
  value: DictationHistoryRetention;
  onChange: (value: DictationHistoryRetention) => void;
}) {
  const { t } = useLingui();
  const labels: Record<DictationHistoryRetention, string> = {
    off: t`Off`,
    day: t`1 day`,
    week: t`7 days`,
    month: t`30 days`,
    forever: t`Forever`,
  };

  return (
    <SettingRow
      title={<Trans>Keep dictations for</Trans>}
      description={
        value === "off" ? (
          <Trans>
            New dictations are not saved. Dictations already saved stay until
            you delete them.
          </Trans>
        ) : (
          <Trans>
            Older dictations and their audio are deleted automatically.
          </Trans>
        )
      }
    >
      {(labelProps) => (
        <Select
          value={value}
          onValueChange={(next) => onChange(normalizeRetention(next))}
        >
          <SelectTrigger {...labelProps} className={SETTING_CONTROL_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DICTATION_HISTORY_RETENTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {labels[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </SettingRow>
  );
}

function History({ retention }: { retention: DictationHistoryRetention }) {
  const { t, i18n } = useLingui();
  const [search, setSearch] = useState("");
  const [query] = useDebounceValue(search, 200);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const { entries, hasMore, isLoading } = useDictationHistory(query, limit);
  const clear = useMutation({
    mutationFn: clearDictations,
    onSuccess: () => setConfirmingClear(false),
  });
  const searching = query.trim() !== "";
  const formatDate = new Intl.DateTimeFormat(i18n.locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <section className="flex flex-col gap-3" aria-label={t`Dictations`}>
      <div className="flex items-center justify-between gap-2">
        <SearchBox
          value={search}
          onChange={(value) => {
            setSearch(value);
            setLimit(PAGE_SIZE);
          }}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={entries.length === 0 && !searching}
          onClick={() => {
            clear.reset();
            setConfirmingClear(true);
          }}
        >
          <Trans>Clear all</Trans>
        </Button>
      </div>
      {entries.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <HistoryItem
              key={entry.id}
              entry={entry}
              formatDate={formatDate}
              expanded={expanded === entry.id}
              onToggle={() =>
                setExpanded(expanded === entry.id ? null : entry.id)
              }
            />
          ))}
        </ul>
      ) : isLoading ? null : (
        <p className="border-border text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          {searching ? (
            <Trans>No dictations match your search.</Trans>
          ) : retention === "off" ? (
            <Trans>
              Dictation history is off. Choose how long to keep dictations to
              start saving them.
            </Trans>
          ) : (
            <Trans>No dictations yet. Dictations you make appear here.</Trans>
          )}
        </p>
      )}
      {hasMore && (
        <Button
          variant="outline"
          size="sm"
          className="self-center"
          onClick={() => setLimit(limit + PAGE_SIZE)}
        >
          <Trans>Show more</Trans>
        </Button>
      )}
      <DestructiveConfirmationDialog
        open={confirmingClear}
        onOpenChange={setConfirmingClear}
        title={<Trans>Clear dictation history?</Trans>}
        description={
          clear.isError ? (
            <Trans>Could not clear your history. Please try again.</Trans>
          ) : (
            <Trans>
              Every saved dictation and its audio are deleted from this
              computer. This cannot be undone.
            </Trans>
          )
        }
        confirmLabel={<Trans>Clear all</Trans>}
        isPending={clear.isPending}
        onConfirm={() => clear.mutate()}
      />
    </section>
  );
}

function SearchBox({
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
        placeholder={t`Search dictations`}
        aria-label={t`Search dictations`}
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

function HistoryItem({
  entry,
  formatDate,
  expanded,
  onToggle,
}: {
  entry: DictationEntry;
  formatDate: Intl.DateTimeFormat;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useLingui();
  const detailsId = useId();
  const copy = useMutation({ mutationFn: (text: string) => writeText(text) });
  const remove = useMutation({ mutationFn: () => deleteDictation(entry.id) });
  const text = entry.finalText || entry.rawText;

  return (
    <li className="border-border rounded-lg border">
      <div className="flex items-start gap-1 p-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 flex-col gap-1 text-left"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={onToggle}
        >
          <span className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <time dateTime={entry.createdAt}>
              {formatTime(formatDate, entry.createdAt)}
            </time>
            <span>{entry.targetAppName ?? t`Unknown app`}</span>
            {entry.model && <span>{displayModelLabel(entry.model)}</span>}
            {!entry.inserted && (
              <span className="text-destructive inline-flex items-center gap-1">
                <Warning className="size-3" aria-hidden="true" />
                <Trans>Not inserted</Trans>
              </span>
            )}
          </span>
          <span
            className={cn([
              "text-sm break-words whitespace-pre-wrap",
              !expanded && "line-clamp-2",
            ])}
          >
            {text}
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t`Copy dictation`}
          disabled={copy.isPending}
          onClick={() => copy.mutate(text)}
        >
          {copy.isSuccess ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t`Delete dictation`}
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          <Trash className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
      {(copy.isError || remove.isError) && (
        <p role="alert" className="text-destructive px-3 pb-3 text-xs">
          {copy.isError ? (
            <Trans>
              Could not copy the dictation. Select the text to copy it.
            </Trans>
          ) : (
            <Trans>Could not delete the dictation. Please try again.</Trans>
          )}
        </p>
      )}
      {expanded && (
        <div
          id={detailsId}
          className="border-border flex flex-col gap-4 border-t p-3"
        >
          {entry.rawText !== entry.finalText && (
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex flex-col gap-1">
                <dt className="text-muted-foreground text-xs">
                  <Trans>Transcript</Trans>
                </dt>
                <dd className="break-words whitespace-pre-wrap">
                  {entry.rawText}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-muted-foreground text-xs">
                  <Trans>Final text</Trans>
                </dt>
                <dd className="break-words whitespace-pre-wrap">
                  {entry.finalText}
                </dd>
              </div>
            </dl>
          )}
          {entry.audioPath && <TranscribeAgain entry={entry} />}
          {entry.versions.length > 0 && (
            <Versions entry={entry} formatDate={formatDate} />
          )}
        </div>
      )}
    </li>
  );
}

function TranscribeAgain({ entry }: { entry: DictationEntry }) {
  const { t } = useLingui();
  const { models, isLoading } = useRetranscriptionModels();
  const retranscribe = useRetranscribe();
  const [selected, setSelected] = useState<string | null>(null);
  const key = (model: { provider: string; model: string }) =>
    `${model.provider}:${model.model}`;
  const choice =
    models.find((model) => key(model) === selected) ??
    models.find((model) => model.model !== entry.model) ??
    models[0];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={choice ? key(choice) : ""}
          onValueChange={setSelected}
          disabled={!choice || retranscribe.isPending}
        >
          <SelectTrigger
            className="h-7 w-56 max-w-full"
            aria-label={t`Model to transcribe with`}
          >
            <SelectValue
              placeholder={isLoading ? t`Checking models…` : t`No model`}
            />
          </SelectTrigger>
          <SelectContent>
            {models.map((model) => (
              <SelectItem key={key(model)} value={key(model)}>
                {model.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          disabled={!choice || retranscribe.isPending}
          onClick={() =>
            choice && retranscribe.mutate({ entry, model: choice })
          }
        >
          {retranscribe.isPending ? (
            <CircleNotch className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowClockwise className="size-3.5" aria-hidden="true" />
          )}
          <Trans>Transcribe again</Trans>
        </Button>
      </div>
      {retranscribe.isError ? (
        <p role="alert" className="text-destructive text-xs">
          {localizeExternalMessage(retranscribe.error.message)}
        </p>
      ) : !isLoading && models.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          <Trans>
            No installed or selected transcription model supports your
            languages. Choose one in Settings, Transcription.
          </Trans>
        </p>
      ) : null}
    </div>
  );
}

function Versions({
  entry,
  formatDate,
}: {
  entry: DictationEntry;
  formatDate: Intl.DateTimeFormat;
}) {
  const { t } = useLingui();
  const restore = useMutation({
    mutationFn: (index: number) => restoreDictationVersion(entry.id, index),
  });

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs font-medium">
        <Trans>Earlier versions</Trans>
      </h4>
      <ol className="flex flex-col gap-2">
        {entry.versions.map((version, index) => (
          <li
            key={`${version.createdAt}:${index}`}
            className="bg-muted/40 flex items-start gap-2 rounded-md p-2"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
                <span>
                  {version.model
                    ? displayModelLabel(version.model)
                    : t`Unknown model`}
                </span>
                <time dateTime={version.createdAt}>
                  {formatTime(formatDate, version.createdAt)}
                </time>
              </span>
              <p className="text-sm break-words whitespace-pre-wrap">
                {version.finalText}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={restore.isPending}
              onClick={() => restore.mutate(index)}
            >
              <ArrowCounterClockwise className="size-3.5" aria-hidden="true" />
              <Trans>Restore</Trans>
            </Button>
          </li>
        ))}
      </ol>
      {restore.isError && (
        <p role="alert" className="text-destructive text-xs">
          {restore.error.message}
        </p>
      )}
    </div>
  );
}
