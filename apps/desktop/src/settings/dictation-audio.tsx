import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { platform } from "@tauri-apps/plugin-os";

import {
  commands as dictation,
  type MediaControl,
} from "@anlg/plugin-dictation";
import { Button } from "@anlg/ui/components/ui/button";
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
  // Windows and Linux report browser tabs like any other player, and need no
  // consent to pause one. On macOS, the browser pause relies on private APIs
  // the App Store build leaves out, and players need Automation consent,
  // which dictation never asks for: the prompt would take the keyboard from
  // the app being dictated into. So it is asked for here.
  const macDirect = os === "macos" && !appStore;
  const playerAccess = useMutation({
    mutationFn: async () => {
      const result = await dictation.requestMediaControl();
      if (result.status === "error") throw new Error(result.error);
      return result.data;
    },
  });
  const describeAccess = (player: string, control: MediaControl) => {
    switch (control) {
      case "allowed":
        return t`${player}: allowed`;
      case "denied":
        return t`${player}: not allowed. Turn it on in System Settings > Privacy & Security > Automation.`;
      case "notDetermined":
        return t`${player}: not decided`;
      case "notRunning":
        return t`${player}: not running`;
    }
  };
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
                them when dictation ends.
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
          <Select
            value={behavior}
            onValueChange={(value) => {
              setBehavior(value);
              if (value === "pause" && macDirect) playerAccess.mutate();
            }}
          >
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
      {behavior === "pause" && macDirect && (
        <div className="flex flex-col gap-2">
          <SettingRow
            title={<Trans>Media player access</Trans>}
            description={
              <Trans>
                Librelog pauses only the players you allow. macOS asks only
                while a player is running, so open it first.
              </Trans>
            }
            controlWidth="content"
          >
            {({ "aria-describedby": describedBy }) => (
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-describedby={describedBy}
                disabled={playerAccess.isPending}
                onClick={() => playerAccess.mutate()}
              >
                <Trans>Allow…</Trans>
              </Button>
            )}
          </SettingRow>
          {playerAccess.data && (
            <ul role="status" className="text-muted-foreground text-xs">
              {playerAccess.data.map(({ player, control }) => (
                <li key={player}>{describeAccess(player, control)}</li>
              ))}
            </ul>
          )}
          {playerAccess.error && (
            <p role="alert" className="text-destructive text-sm">
              {playerAccess.error.message}
            </p>
          )}
        </div>
      )}
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
      {behavior === "pause" && macDirect && (
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
