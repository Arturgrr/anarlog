import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useId } from "react";

import { commands as annotate } from "@anlg/plugin-annotate";
import { commands as opener } from "@anlg/plugin-opener2";
import { commands as shortcutCommands } from "@anlg/plugin-shortcut";
import { Button } from "@anlg/ui/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@anlg/ui/components/ui/select";

import {
  ShortcutCapture,
  ShortcutCaptureHint,
  ShortcutKeys,
  shortcutKeys,
  useKeyLabel,
  useShortcutRecorder,
} from "./dictation-shortcut";

import { useAnnotateStatus } from "~/annotate/state";
import {
  annotateAvailable,
  openScreenRecordingSettings,
} from "~/annotate/system";
import { localizeExternalMessage } from "~/i18n/external-messages";
import { SettingsPageTitle } from "~/settings/page-title";
import { setSettingValue, useSetSettingValue } from "~/settings/queries";
import {
  SETTING_CONTROL_CLASS,
  SettingRow,
  SettingSwitchRow,
} from "~/settings/setting-row";
import { useConfigValue } from "~/shared/config";

const RETENTIONS = ["week", "month", "forever"] as const;
type Slot = "annotate" | "paste";

function unwrap<T>(
  result: { status: "ok"; data: T } | { status: "error"; error: string },
): T {
  if (result.status === "error") throw new Error(result.error);
  return result.data;
}

export function SettingsAnnotate() {
  const { t } = useLingui();
  const enabled = useConfigValue("annotate_enabled");
  const setEnabled = useSetSettingValue("annotate_enabled");
  const retention = useConfigValue("annotate_retention");
  const setRetention = useSetSettingValue("annotate_retention");
  const phase = useAnnotateStatus((state) => state.phase);
  const registrationError = useAnnotateStatus((state) => state.error);
  const available = annotateAvailable();
  const reveal = useMutation({
    mutationFn: async () => {
      const dir = unwrap(await annotate.annotationsDir());
      unwrap(await opener.openPath(dir, null));
    },
  });

  if (!available) {
    return (
      <div className="flex flex-col gap-8">
        <SettingsPageTitle title={<Trans>Annotate</Trans>} />
        <p className="text-muted-foreground text-sm">
          <Trans>
            Annotate is available in the macOS app downloaded from the website.
          </Trans>
        </p>
      </div>
    );
  }

  const retentionLabels = {
    week: t`Week`,
    month: t`Month`,
    forever: t`Forever`,
  };

  return (
    <div className="flex flex-col gap-8">
      <SettingsPageTitle title={<Trans>Annotate</Trans>} />
      <div className="flex flex-col gap-6">
        <p className="text-muted-foreground text-sm">
          <Trans>
            Experimental. Record your screen while you draw on it in red and
            talk, then paste the result into a coding agent such as Claude Code:
            numbered key frames with your marks, and what you said at each one.
          </Trans>
        </p>
        <SettingSwitchRow
          title={<Trans>Enable Annotate</Trans>}
          description={
            <Trans>
              Keep Librelog running to use the Annotate shortcuts in other apps.
            </Trans>
          }
          checked={enabled}
          onChange={setEnabled}
        />
        {enabled && <AnnotateShortcutSettings />}
        {enabled && registrationError && (
          <p role="alert" className="text-destructive text-sm">
            {registrationError}
          </p>
        )}
        {enabled && phase !== "idle" && (
          <p className="text-sm" role="status">
            {phase === "recording"
              ? t`Recording…`
              : phase === "starting"
                ? t`Starting…`
                : t`Finishing the annotation…`}
          </p>
        )}
        <ScreenRecordingPermission />
        <SettingRow
          title={<Trans>Keep annotations for</Trans>}
          description={
            retention === "forever" ? (
              <Trans>Nothing is deleted automatically.</Trans>
            ) : retention === "month" ? (
              <Trans>
                Video and audio are deleted after 30 days, the rest of each
                annotation after 90.
              </Trans>
            ) : (
              <Trans>
                Video and audio are deleted after 7 days, the rest of each
                annotation after 30.
              </Trans>
            )
          }
        >
          {(labelProps) => (
            <Select
              value={retention}
              onValueChange={(next) => void setRetention(next)}
            >
              <SelectTrigger {...labelProps} className={SETTING_CONTROL_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RETENTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {retentionLabels[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </SettingRow>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={reveal.isPending}
            onClick={() => reveal.mutate()}
          >
            <Trans>Show annotations folder</Trans>
          </Button>
        </div>
        {reveal.isError && (
          <p role="alert" className="text-destructive text-sm">
            {localizeExternalMessage(reveal.error.message)}
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          <Trans>
            A recording holds everything shown on the display under the pointer,
            what your microphone hears, your red marks, and the name and title
            of the app in front. Each one is a folder on this computer, in
            Librelog's data folder under annotations, with the video, the audio,
            the key frames, a contact sheet and a summary. Your narration is
            transcribed by your transcription provider. Nothing else leaves this
            computer until you paste it somewhere: then it goes to that app and
            its provider.
          </Trans>
        </p>
      </div>
    </div>
  );
}

function AnnotateShortcutSettings() {
  const { t } = useLingui();
  const label = useKeyLabel();
  const hintId = useId();
  const shortcut = useConfigValue("annotate_shortcut");
  const paste = useConfigValue("annotate_paste_shortcut");
  const dictation = useConfigValue("dictation_shortcuts");
  const pasteLastDictation = useConfigValue("dictation_paste_last_shortcut");
  const recorder = useShortcutRecorder<Slot>({
    validate: async (value, slot) => {
      const taken = [
        ...dictation,
        pasteLastDictation,
        slot === "annotate" ? paste : shortcut,
      ];
      const result = await shortcutCommands.validateAnnotate(value, taken);
      return result.status === "error"
        ? localizeExternalMessage(result.error)
        : null;
    },
    persist: (value, slot) =>
      setSettingValue(
        slot === "annotate" ? "annotate_shortcut" : "annotate_paste_shortcut",
        value,
      ),
  });
  const rows: {
    slot: Slot;
    value: string;
    title: ReactNode;
    description: ReactNode;
    captureLabel: string;
  }[] = [
    {
      slot: "annotate",
      value: shortcut,
      title: <Trans>Annotate shortcut</Trans>,
      description: (
        <Trans>
          Press to start recording the display under the pointer, and again to
          finish. While recording, hold it to draw in red where the pointer
          goes; let go to stop drawing. Escape turns drawing off.
        </Trans>
      ),
      captureLabel: t`New Annotate shortcut`,
    },
    {
      slot: "paste",
      value: paste,
      title: <Trans>Paste last annotation shortcut</Trans>,
      description: (
        <Trans>
          Pastes the contact sheet's file path, then the summary, into the
          focused app. In Claude Code and similar terminal agents, the path
          attaches the image.
        </Trans>
      ),
      captureLabel: t`New Paste last annotation shortcut`,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const parts = shortcutKeys(row.value);
        const keys = parts.map(label).join(" ");
        return (
          <SettingRow
            key={row.slot}
            title={row.title}
            description={row.description}
            controlWidth="content"
          >
            {() =>
              recorder.editing === row.slot ? (
                <ShortcutCapture
                  label={row.captureLabel}
                  doubleTap={false}
                  describedBy={hintId}
                  busy={recorder.saving}
                  onInput={recorder.input}
                  onConfirm={(value) => recorder.save(value, row.slot)}
                  onCancel={recorder.finish}
                />
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  aria-label={t`Change shortcut ${keys}`}
                  disabled={recorder.saving || recorder.editing !== null}
                  onClick={() => recorder.start(row.slot)}
                >
                  <ShortcutKeys keys={parts} />
                </Button>
              )
            }
          </SettingRow>
        );
      })}
      {recorder.editing !== null && (
        <ShortcutCaptureHint id={hintId} doubleTap={false} />
      )}
      {recorder.error && (
        <p role="alert" className="text-destructive text-sm">
          {recorder.error.message}
        </p>
      )}
    </div>
  );
}

function ScreenRecordingPermission() {
  const { t } = useLingui();
  // Probed only on this page: the check can fall back to a capture that
  // macOS may answer with its prompt.
  const access = useQuery({
    queryKey: ["annotate-screen-recording"],
    queryFn: async () => unwrap(await annotate.screenRecording()),
    refetchOnWindowFocus: true,
  });
  const open = useMutation({ mutationFn: openScreenRecordingSettings });
  const labels: Record<string, string> = {
    granted: t`Allowed`,
    denied: t`Not allowed`,
    not_determined: t`Not asked yet. macOS asks the first time you annotate.`,
    needs_restart: t`Allowed. Quit and reopen Librelog to use it.`,
  };

  return (
    <SettingRow
      title={<Trans>Screen Recording</Trans>}
      description={
        access.data
          ? (labels[access.data] ?? access.data)
          : access.isError
            ? localizeExternalMessage(access.error.message)
            : t`Checking…`
      }
      controlWidth="content"
    >
      {() => (
        <Button
          variant="outline"
          disabled={open.isPending}
          onClick={() => open.mutate()}
        >
          <Trans>Open System Settings</Trans>
        </Button>
      )}
    </SettingRow>
  );
}
