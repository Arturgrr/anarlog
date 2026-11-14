import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useId } from "react";

import { commands as shortcutCommands } from "@anlg/plugin-shortcut";
import { X } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { Switch } from "@anlg/ui/components/ui/switch";

import {
  ShortcutCapture,
  ShortcutCaptureHint,
  ShortcutKeys,
  shortcutKeys,
  useKeyLabel,
  useShortcutRecorder,
} from "./dictation-shortcut";

import { useAnnotateShortcuts } from "~/annotate/system";
import {
  CAPTURE_SHORTCUT_KEYS,
  type CaptureAction,
  useCaptureShortcutMap,
} from "~/capture/system";
import { useSystemShortcuts } from "~/capture/system-shortcuts";
import { localizeExternalMessage } from "~/i18n/external-messages";
import { setSettingValue } from "~/settings/queries";
import { SettingRow } from "~/settings/setting-row";
import { useConfigValue } from "~/shared/config";

function useRows(): Record<
  CaptureAction,
  { title: ReactNode; description: ReactNode; captureLabel: string }
> {
  const { t } = useLingui();
  return {
    area: {
      title: <Trans>Capture area</Trans>,
      description: (
        <Trans>
          Drag over what you want. Space switches to picking a window.
        </Trans>
      ),
      captureLabel: t`New Capture area shortcut`,
    },
    fullscreen: {
      title: <Trans>Capture full screen</Trans>,
      description: <Trans>Takes the display under the pointer at once.</Trans>,
      captureLabel: t`New Capture full screen shortcut`,
    },
    window: {
      title: <Trans>Capture window</Trans>,
      description: <Trans>Click the window you want.</Trans>,
      captureLabel: t`New Capture window shortcut`,
    },
    record: {
      title: <Trans>Record screen</Trans>,
      description: (
        <Trans>
          Records a movie (MP4) of an area, a window or the whole screen. Press
          it again to stop.
        </Trans>
      ),
      captureLabel: t`New Record screen shortcut`,
    },
    gif: {
      title: <Trans>Record GIF</Trans>,
      description: (
        <Trans>Records an animated GIF. Press it again to stop.</Trans>
      ),
      captureLabel: t`New Record GIF shortcut`,
    },
  };
}

/** Recorders for Capture's shortcuts; each can be cleared to unbound. */
export function CaptureShortcutRows({
  actions,
}: {
  actions: readonly CaptureAction[];
}) {
  const { t } = useLingui();
  const label = useKeyLabel();
  const hintId = useId();
  const rows = useRows();
  const current = useCaptureShortcutMap();
  const dictation = useConfigValue("dictation_shortcuts");
  const pasteLastEnabled = useConfigValue("dictation_paste_last_enabled");
  const pasteLast = useConfigValue("dictation_paste_last_shortcut");
  const annotate = useAnnotateShortcuts();
  const recorder = useShortcutRecorder<CaptureAction>({
    validate: async (value, action) => {
      const siblings = Object.entries(current)
        .filter(([other, shortcut]) => other !== action && shortcut)
        .map(([, shortcut]) => shortcut);
      const taken = [
        ...dictation,
        ...(pasteLastEnabled ? [pasteLast] : []),
        ...annotate,
        ...siblings,
      ];
      const result = await shortcutCommands.validateCapture(value, taken);
      return result.status === "error"
        ? localizeExternalMessage(result.error)
        : null;
    },
    persist: (value, action) =>
      setSettingValue(CAPTURE_SHORTCUT_KEYS[action], value),
  });
  const clear = useMutation({
    mutationFn: (action: CaptureAction) =>
      setSettingValue(CAPTURE_SHORTCUT_KEYS[action], ""),
  });
  const busy = recorder.saving || clear.isPending;
  const error = recorder.error ?? clear.error;

  return (
    <div className="flex flex-col gap-3">
      {actions.map((action) => {
        const value = current[action];
        const parts = value ? shortcutKeys(value) : [];
        const keys = parts.map(label).join(" ");
        const row = rows[action];
        return (
          <SettingRow
            key={action}
            title={row.title}
            description={row.description}
            controlWidth="content"
          >
            {() =>
              recorder.editing === action ? (
                <ShortcutCapture
                  label={row.captureLabel}
                  doubleTap={false}
                  describedBy={hintId}
                  busy={recorder.saving}
                  onInput={recorder.input}
                  onConfirm={(next) => recorder.save(next, action)}
                  onCancel={recorder.finish}
                />
              ) : (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={
                      value ? t`Change shortcut ${keys}` : t`Set a shortcut`
                    }
                    disabled={busy || recorder.editing !== null}
                    onClick={() => {
                      clear.reset();
                      recorder.start(action);
                    }}
                  >
                    {value ? (
                      <ShortcutKeys keys={parts} />
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        <Trans>Not set</Trans>
                      </span>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={t`Clear shortcut`}
                    disabled={busy || !value || recorder.editing !== null}
                    onClick={() => clear.mutate(action)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              )
            }
          </SettingRow>
        );
      })}
      {recorder.editing !== null && (
        <ShortcutCaptureHint id={hintId} doubleTap={false} />
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error.message}
        </p>
      )}
    </div>
  );
}

/** The switch that hands ⌘⇧3, ⌘⇧4 and ⌘⇧5 to Librelog, and its state. */
export function ReplaceSystemShortcuts() {
  const system = useSystemShortcuts();
  const status = system.status.data;
  const state = system.status.isError
    ? null
    : !status
      ? null
      : status.replaced && !status.area && !status.fullscreen && !status.options
        ? "replaced"
        : !status.area && !status.fullscreen && !status.options
          ? "off"
          : "on";

  return (
    <div className="flex flex-col gap-3">
      <SettingRow
        title={<Trans>Replace the macOS screenshot shortcuts</Trans>}
        description={
          <>
            <Trans>
              Turns off macOS's ⌘⇧3, ⌘⇧4 and ⌘⇧5 and uses them for Capture full
              screen, Capture area and Record screen (⌘⇧6 records a GIF).
              Turning this off gives them back to macOS.
            </Trans>{" "}
            {state === "replaced" ? (
              <Trans>macOS shortcuts: replaced by Librelog.</Trans>
            ) : state === "on" ? (
              <Trans>macOS shortcuts: on.</Trans>
            ) : state === "off" ? (
              <Trans>macOS shortcuts: off.</Trans>
            ) : null}
          </>
        }
        controlWidth="content"
      >
        {(labelProps) => (
          <Switch
            {...labelProps}
            checked={system.replaced}
            disabled={system.pending}
            onCheckedChange={system.setReplaced}
          />
        )}
      </SettingRow>
      {system.needsManualStep && (
        <div
          role="status"
          className="bg-muted/40 flex flex-col gap-2 rounded-lg border p-3 text-sm"
        >
          <p>
            <Trans>
              macOS kept some of its screenshot shortcuts on. Open System
              Settings → Keyboard → Keyboard Shortcuts → Screenshots and turn
              the shortcuts off, then check again.
            </Trans>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={system.openKeyboardSettings}
            >
              <Trans>Open Keyboard Settings</Trans>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={system.pending}
              onClick={system.checkAgain}
            >
              <Trans>Check again</Trans>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={system.pending}
              onClick={() => system.setReplaced(false)}
            >
              <Trans>Keep the macOS shortcuts</Trans>
            </Button>
          </div>
        </div>
      )}
      {system.error && (
        <p role="alert" className="text-destructive text-sm">
          {localizeExternalMessage(system.error.message)}
        </p>
      )}
    </div>
  );
}
