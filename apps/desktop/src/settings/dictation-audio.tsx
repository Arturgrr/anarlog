import { Trans, useLingui } from "@lingui/react/macro";
import { platform } from "@tauri-apps/plugin-os";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@anlg/ui/components/ui/select";

import {
  dictationAudioBehaviors,
  normalizeDictationAudioBehavior,
  normalizeDuckVolume,
} from "~/dictation/environment";
import { useSetSettingValue } from "~/settings/queries";
import {
  SETTING_CONTROL_CLASS,
  SettingRow,
  SettingSwitchRow,
} from "~/settings/setting-row";
import { isAppStoreBuild } from "~/shared/app-store";
import { useConfigValue } from "~/shared/config";

const DUCK_VOLUME_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];

export function DictationAudioSettings() {
  const { t, i18n } = useLingui();
  const os = platform();
  const appStore = isAppStoreBuild();
  const available = dictationAudioBehaviors({ os, appStore });
  const behavior = normalizeDictationAudioBehavior(
    useConfigValue("dictation_audio_behavior"),
    available,
  );
  const setBehavior = useSetSettingValue("dictation_audio_behavior");
  const duckVolume = normalizeDuckVolume(
    useConfigValue("dictation_audio_duck_volume"),
  );
  const setDuckVolume = useSetSettingValue("dictation_audio_duck_volume");
  const pauseBrowser = useConfigValue("dictation_audio_pause_browser");
  const setPauseBrowser = useSetSettingValue("dictation_audio_pause_browser");
  // Windows and Linux report browser tabs like any other player. The macOS
  // browser pause relies on private APIs the App Store build leaves out.
  const browserPause = os === "macos" && !appStore;
  const percent = new Intl.NumberFormat(i18n.locale, { style: "percent" });
  const steps = DUCK_VOLUME_STEPS.includes(duckVolume)
    ? DUCK_VOLUME_STEPS
    : [...DUCK_VOLUME_STEPS, duckVolume].sort((a, b) => a - b);
  const labels = {
    nothing: t`Do nothing`,
    mute: t`Mute`,
    duck: t`Lower audio`,
    pause: t`Pause media`,
  };

  return (
    <div className="flex flex-col gap-4">
      <SettingRow
        title={<Trans>While dictating</Trans>}
        description={
          behavior === "mute" ? (
            <Trans>Mutes your computer's sound until dictation ends.</Trans>
          ) : behavior === "duck" ? (
            <Trans>
              Smoothly lowers your computer's sound, then brings it back when
              dictation ends.
            </Trans>
          ) : behavior === "pause" ? (
            os === "macos" ? (
              <Trans>
                Pauses Music, Spotify, and VLC if they are playing, and resumes
                them when dictation ends. macOS asks once for permission to
                control each of them.
              </Trans>
            ) : (
              <Trans>
                Pauses apps and browser tabs that are playing, and resumes them
                when dictation ends.
              </Trans>
            )
          ) : appStore && os === "macos" ? (
            <Trans>
              Other audio keeps playing while you dictate. Librelog from the App
              Store can't pause other apps, but it can mute or lower your
              computer's sound.
            </Trans>
          ) : (
            <Trans>Other audio keeps playing while you dictate.</Trans>
          )
        }
      >
        {(labelProps) => (
          <Select value={behavior} onValueChange={setBehavior}>
            <SelectTrigger {...labelProps} className={SETTING_CONTROL_CLASS}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {available.map((option) => (
                <SelectItem key={option} value={option}>
                  {labels[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </SettingRow>
      {behavior === "duck" && (
        <SettingRow
          title={<Trans>Lower to</Trans>}
          description={
            <Trans>
              Of the volume your computer had when dictation started.
            </Trans>
          }
        >
          {(labelProps) => (
            <Select
              value={String(duckVolume)}
              onValueChange={(value) => setDuckVolume(Number(value))}
            >
              <SelectTrigger {...labelProps} className={SETTING_CONTROL_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {steps.map((step) => (
                  <SelectItem key={step} value={String(step)}>
                    {percent.format(step / 100)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </SettingRow>
      )}
      {behavior === "pause" && browserPause && (
        <SettingSwitchRow
          title={<Trans>Also pause the browser</Trans>}
          description={
            <Trans>
              Pauses a browser tab that is playing sound, and plays it again
              only if the pause worked. Needs the System Audio Recording
              permission.
            </Trans>
          }
          checked={pauseBrowser}
          onChange={setPauseBrowser}
        />
      )}
    </div>
  );
}
