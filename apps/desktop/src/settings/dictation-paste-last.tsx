import { Trans, useLingui } from "@lingui/react/macro";
import { platform } from "@tauri-apps/plugin-os";
import { useId } from "react";

import { commands as shortcutCommands } from "@anlg/plugin-shortcut";
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

import { usePasteLastStatus } from "~/dictation/paste-last";
import { localizeExternalMessage } from "~/i18n/external-messages";
import { setSettingValue, useSetSettingValue } from "~/settings/queries";
import { SettingRow, SettingSwitchRow } from "~/settings/setting-row";
import { useConfigValue } from "~/shared/config";

export function DictationPasteLastSettings() {
  const { t } = useLingui();
  const mac = platform() === "macos";
  const label = useKeyLabel();
  const hintId = useId();
  const enabled = useConfigValue("dictation_paste_last_enabled");
  const setEnabled = useSetSettingValue("dictation_paste_last_enabled");
  const shortcut = useConfigValue("dictation_paste_last_shortcut");
  const dictationShortcuts = useConfigValue("dictation_shortcuts");
  const keep = useConfigValue("dictation_keep_on_clipboard");
  const setKeep = useSetSettingValue("dictation_keep_on_clipboard");
  const registrationError = usePasteLastStatus((state) => state.error);
  const recorder = useShortcutRecorder<"paste-last">({
    validate: async (value) => {
      const result = await shortcutCommands.validatePasteLast(
        value,
        dictationShortcuts,
      );
      return result.status === "error"
        ? localizeExternalMessage(result.error)
        : null;
    },
    persist: (value) => setSettingValue("dictation_paste_last_shortcut", value),
  });
  const parts = shortcutKeys(shortcut);
  const keys = parts.map(label).join(" ");
  const error = recorder.error?.message ?? registrationError;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <SettingRow
          title={<Trans>Paste last dictation shortcut</Trans>}
          description={
            mac ? (
              <Trans>
                Paste your last dictation into the focused app again. It's also
                in the menu bar icon's menu.
              </Trans>
            ) : (
              <Trans>
                Paste your last dictation into the focused app again. It's also
                in the tray icon's menu.
              </Trans>
            )
          }
          controlWidth="content"
        >
          {(labelProps) => (
            <div className="flex items-center gap-3">
              {enabled &&
                (recorder.editing !== null ? (
                  <ShortcutCapture
                    label={t`New paste last dictation shortcut`}
                    doubleTap={false}
                    describedBy={hintId}
                    busy={recorder.saving}
                    onInput={recorder.input}
                    onConfirm={(value) => recorder.save(value, "paste-last")}
                    onCancel={recorder.finish}
                  />
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={t`Change shortcut ${keys}`}
                    disabled={recorder.saving}
                    onClick={() => recorder.start("paste-last")}
                  >
                    <ShortcutKeys keys={parts} />
                  </Button>
                ))}
              <Switch
                {...labelProps}
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>
          )}
        </SettingRow>
        {recorder.editing !== null && (
          <ShortcutCaptureHint id={hintId} doubleTap={false} />
        )}
        {enabled && error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>
      <SettingSwitchRow
        title={<Trans>Keep last dictation on the clipboard</Trans>}
        description={
          mac ? (
            <Trans>
              Paste it anywhere with ⌘V, without a shortcut. It replaces what
              was on the clipboard.
            </Trans>
          ) : (
            <Trans>
              Paste it anywhere with Ctrl+V, without a shortcut. It replaces
              what was on the clipboard.
            </Trans>
          )
        }
        checked={keep}
        onChange={setKeep}
      />
    </div>
  );
}
