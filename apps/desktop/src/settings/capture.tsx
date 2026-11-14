import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { appDataDir, downloadDir, homeDir } from "@tauri-apps/api/path";
import { open as selectFolder } from "@tauri-apps/plugin-dialog";
import type { ReactNode } from "react";

import { commands as annotate } from "@anlg/plugin-annotate";
import { commands as opener } from "@anlg/plugin-opener2";
import { FolderSimple } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@anlg/ui/components/ui/select";

import { RecentCaptures } from "./capture-recent";
import {
  CaptureShortcutRows,
  ReplaceSystemShortcuts,
} from "./capture-shortcuts";
import { displayPath } from "./general/storage/path-utils";

import { openScreenRecordingSettings } from "~/annotate/system";
import { unwrap } from "~/capture/lifecycle";
import { useCaptureStatus } from "~/capture/state";
import { CAPTURE_ACTIONS, captureAvailable } from "~/capture/system";
import { useSystemShortcuts } from "~/capture/system-shortcuts";
import { localizeExternalMessage } from "~/i18n/external-messages";
import { SettingsPageTitle } from "~/settings/page-title";
import { setSettingValue, useSetSettingValue } from "~/settings/queries";
import type { SettingKey } from "~/settings/schema";
import {
  SETTING_CONTROL_CLASS,
  SettingRow,
  SettingSwitchRow,
} from "~/settings/setting-row";
import { useConfigValue } from "~/shared/config";

export function SettingsCapture() {
  if (!captureAvailable()) {
    return (
      <div className="flex flex-col gap-8">
        <SettingsPageTitle title={<Trans>Screenshots</Trans>} />
        <p className="text-muted-foreground text-sm">
          <Trans>
            Screenshots and screen recordings are available in the macOS app
            downloaded from the website.
          </Trans>
        </p>
      </div>
    );
  }
  return <CapturePage />;
}

function Section({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-sans text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function CapturePage() {
  const enabled = useConfigValue("capture_enabled");
  const registrationError = useCaptureStatus((state) => state.error);
  const system = useSystemShortcuts();

  return (
    <div className="flex flex-col gap-8">
      <SettingsPageTitle title={<Trans>Screenshots</Trans>} />
      <div className="flex flex-col gap-6">
        <SettingSwitchRow
          title={<Trans>Enable screenshots and recordings</Trans>}
          description={
            system.replaced ? (
              <Trans>
                Take screenshots, record the screen as a movie or a GIF, and
                mark them up, with shortcuts that work in any app. Turning this
                off gives macOS its screenshot shortcuts back: turn it off
                before uninstalling Librelog.
              </Trans>
            ) : (
              <Trans>
                Take screenshots, record the screen as a movie or a GIF, and
                mark them up, with shortcuts that work in any app.
              </Trans>
            )
          }
          checked={enabled}
          disabled={system.pending}
          onChange={(on) =>
            on
              ? void setSettingValue("capture_enabled", true)
              : system.disableCapture()
          }
        />
        {enabled && registrationError && (
          <p role="alert" className="text-destructive text-sm">
            {registrationError}
          </p>
        )}
        <ScreenRecordingPermission />
      </div>
      {enabled && (
        <>
          <Section title={<Trans>Shortcuts</Trans>}>
            <CaptureShortcutRows actions={CAPTURE_ACTIONS} />
            <ReplaceSystemShortcuts />
          </Section>
          <AfterCapturing />
          <Section title={<Trans>Screenshots</Trans>}>
            <ScreenshotSettings />
          </Section>
          <Section title={<Trans>Recordings</Trans>}>
            <RecordingSettings />
          </Section>
        </>
      )}
      <Section title={<Trans>Recent captures</Trans>}>
        <RecentCapturesWithFolder />
      </Section>
      <p className="text-muted-foreground text-xs">
        <Trans>
          Captures stay on this Mac, in the folder you choose or in Librelog's
          data folder. Nothing leaves it until you paste or share a capture:
          then it goes wherever you paste it.
        </Trans>
      </p>
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
    not_determined: t`Not asked yet. macOS asks the first time you capture.`,
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

function Switch({
  setting,
  title,
  description,
}: {
  setting: Extract<
    SettingKey,
    | "capture_copy_to_clipboard"
    | "capture_save_to_folder"
    | "capture_show_card"
    | "capture_open_editor"
    | "capture_show_cursor"
    | "capture_record_cursor"
    | "capture_record_microphone"
    | "capture_record_system_audio"
  >;
  title: ReactNode;
  description?: ReactNode;
}) {
  const checked = useConfigValue(setting);
  const set = useSetSettingValue(setting);
  return (
    <SettingSwitchRow
      title={title}
      description={description}
      checked={checked}
      onChange={set}
    />
  );
}

function Choice<K extends SettingKey>({
  setting,
  title,
  description,
  options,
}: {
  setting: K;
  title: ReactNode;
  description?: ReactNode;
  options: { value: string; label: string }[];
}) {
  const value = useConfigValue(setting);
  const numeric = typeof value === "number";
  return (
    <SettingRow title={title} description={description}>
      {(labelProps) => (
        <Select
          value={String(value)}
          onValueChange={(next) =>
            void setSettingValue(
              setting,
              (numeric ? Number(next) : next) as never,
            ).catch((error) =>
              console.error(`[settings] failed to update ${setting}`, error),
            )
          }
        >
          <SelectTrigger {...labelProps} className={SETTING_CONTROL_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </SettingRow>
  );
}

function AfterCapturing() {
  const saveToFolder = useConfigValue("capture_save_to_folder");
  return (
    <Section title={<Trans>After capturing</Trans>}>
      <Switch
        setting="capture_copy_to_clipboard"
        title={<Trans>Copy to the clipboard</Trans>}
      />
      <Switch
        setting="capture_save_to_folder"
        title={<Trans>Save to a folder</Trans>}
        description={
          <Trans>
            When this is off, captures are kept in Librelog's data folder and
            listed below.
          </Trans>
        }
      />
      {saveToFolder && <CaptureFolderRow />}
      <Switch
        setting="capture_show_card"
        title={<Trans>Show a card</Trans>}
        description={
          <Trans>
            A preview in the corner of the screen to copy, save or edit the
            capture, or drag it into another app.
          </Trans>
        }
      />
      <Switch
        setting="capture_open_editor"
        title={<Trans>Open the editor right away</Trans>}
        description={<Trans>For screenshots.</Trans>}
      />
    </Section>
  );
}

function useCaptureFolder() {
  const folder = useConfigValue("capture_folder");
  const downloads = useQuery({
    queryKey: ["download-dir"],
    queryFn: downloadDir,
  });
  return { folder, path: folder || downloads.data };
}

function CaptureFolderRow() {
  const { t } = useLingui();
  const { folder, path } = useCaptureFolder();
  const { data: home } = useQuery({ queryKey: ["home-dir"], queryFn: homeDir });
  const change = useMutation({
    mutationFn: async (action: "choose" | "reset") => {
      if (action === "reset") return setSettingValue("capture_folder", "");
      const selected = await selectFolder({
        title: t`Choose a folder for captures`,
        directory: true,
        multiple: false,
        defaultPath: path,
      });
      if (selected && selected !== path) {
        await setSettingValue("capture_folder", selected);
      }
    },
  });

  return (
    <div className="flex flex-col gap-1">
      <div className="flex w-full min-w-0 items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <FolderSimple className="text-muted-foreground size-4 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-medium">
              {folder ? <Trans>Folder</Trans> : <Trans>Downloads</Trans>}
            </h3>
            <p className="text-muted-foreground truncate text-xs" title={path}>
              {displayPath(path, home)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {folder && (
            <Button
              variant="ghost"
              disabled={change.isPending}
              onClick={() => change.mutate("reset")}
            >
              <Trans>Use Downloads</Trans>
            </Button>
          )}
          <Button
            variant="outline"
            disabled={change.isPending}
            onClick={() => change.mutate("choose")}
          >
            <Trans>Choose…</Trans>
          </Button>
        </div>
      </div>
      {change.isError && (
        <p role="alert" className="text-destructive text-xs">
          {localizeExternalMessage(change.error.message)}
        </p>
      )}
    </div>
  );
}

function ScreenshotSettings() {
  return (
    <>
      <Choice
        setting="capture_image_format"
        title={<Trans>Format</Trans>}
        description={
          <Trans>PNG keeps every pixel; JPEG makes smaller files.</Trans>
        }
        options={[
          { value: "png", label: "PNG" },
          { value: "jpeg", label: "JPEG" },
        ]}
      />
      <Switch
        setting="capture_show_cursor"
        title={<Trans>Include the pointer</Trans>}
      />
    </>
  );
}

function RecordingSettings() {
  const { t } = useLingui();
  return (
    <>
      <Choice
        setting="capture_record_fps"
        title={<Trans>Frame rate</Trans>}
        options={[
          { value: "30", label: t`30 fps` },
          { value: "60", label: t`60 fps` },
        ]}
      />
      <Switch
        setting="capture_record_cursor"
        title={<Trans>Show the pointer</Trans>}
      />
      <Choice
        setting="capture_record_countdown"
        title={<Trans>Countdown</Trans>}
        description={<Trans>Before the recording starts.</Trans>}
        options={[
          { value: "0", label: t`Off` },
          { value: "3", label: t`3 seconds` },
        ]}
      />
      <Switch
        setting="capture_record_microphone"
        title={<Trans>Record the microphone</Trans>}
      />
      <Switch
        setting="capture_record_system_audio"
        title={<Trans>Record system audio</Trans>}
      />
      <p className="text-muted-foreground -mt-2 text-xs">
        <Trans>
          Audio in recordings is experimental. A movie with both has two audio
          tracks. GIFs have no sound.
        </Trans>
      </p>
      <Choice
        setting="capture_gif_fps"
        title={<Trans>GIF frame rate</Trans>}
        description={
          <Trans>Long GIFs use a lower frame rate to stay small.</Trans>
        }
        options={[
          { value: "10", label: t`10 fps` },
          { value: "15", label: t`15 fps` },
          { value: "20", label: t`20 fps` },
        ]}
      />
      <Choice
        setting="capture_gif_max_width"
        title={<Trans>GIF width</Trans>}
        description={<Trans>At most; smaller areas keep their size.</Trans>}
        options={[
          { value: "480", label: t`480 pixels` },
          { value: "720", label: t`720 pixels` },
          { value: "1080", label: t`1080 pixels` },
        ]}
      />
    </>
  );
}

function RecentCapturesWithFolder() {
  const saveToFolder = useConfigValue("capture_save_to_folder");
  const { path } = useCaptureFolder();
  const show = useMutation({
    mutationFn: async () => {
      const dir = saveToFolder
        ? path
        : `${(await appDataDir()).replace(/\/$/u, "")}/captures/files`;
      if (!dir) return;
      unwrap(await opener.openPath(dir, null));
    },
  });
  return (
    <>
      <RecentCaptures onShowFolder={() => show.mutate()} />
      {show.isError && (
        <p role="alert" className="text-destructive text-sm">
          {localizeExternalMessage(show.error.message)}
        </p>
      )}
    </>
  );
}
