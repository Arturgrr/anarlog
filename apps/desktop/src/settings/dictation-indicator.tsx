import { Trans, useLingui } from "@lingui/react/macro";
import { platform } from "@tauri-apps/plugin-os";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@anlg/ui/components/ui/select";

import { hudPositions, normalizeHudPosition } from "~/dictation/hud-position";
import { useSetSettingValue } from "~/settings/queries";
import { SETTING_CONTROL_CLASS, SettingRow } from "~/settings/setting-row";
import { useConfigValue } from "~/shared/config";

export function DictationIndicatorSetting() {
  const { t } = useLingui();
  const os = platform();
  const position = normalizeHudPosition(
    useConfigValue("dictation_hud_position"),
    os,
  );
  const setPosition = useSetSettingValue("dictation_hud_position");
  const labels = {
    top: t`Top`,
    bottom: t`Bottom`,
    hidden: t`Hidden`,
    notch: t`Notch`,
  };

  return (
    <SettingRow
      title={<Trans>Dictation indicator</Trans>}
      description={
        position === "notch" ? (
          <Trans>
            On a MacBook with a notch the indicator grows out of the notch; on
            other displays it sits at the top.
          </Trans>
        ) : position === "hidden" ? (
          <Trans>
            Nothing is shown; the start and stop sounds, if on, are the only
            cue.
          </Trans>
        ) : (
          <Trans>Where the indicator shows while you dictate.</Trans>
        )
      }
    >
      {(labelProps) => (
        <Select value={position} onValueChange={setPosition}>
          <SelectTrigger {...labelProps} className={SETTING_CONTROL_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {hudPositions(os).map((option) => (
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
