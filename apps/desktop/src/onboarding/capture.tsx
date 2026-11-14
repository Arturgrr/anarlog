import { Trans } from "@lingui/react/macro";

import { Switch } from "@anlg/ui/components/ui/switch";

import { OnboardingButton } from "./shared";

import { useSystemShortcuts } from "~/capture/system-shortcuts";
import {
  CaptureShortcutRows,
  ReplaceSystemShortcuts,
} from "~/settings/capture-shortcuts";
import { setSettingValue } from "~/settings/queries";
import { SettingRow } from "~/settings/setting-row";
import { useConfigValue } from "~/shared/config";

const MAIN_ACTIONS = ["area", "record"] as const;

/** Turns Capture off again, and gives macOS its shortcuts back, when skipped. */
export function useSkipCapture(onNext: () => void) {
  const enabled = useConfigValue("capture_enabled");
  const system = useSystemShortcuts();
  return () => {
    if (enabled) system.disableCapture();
    onNext();
  };
}

export function CaptureStep({ onContinue }: { onContinue: () => void }) {
  const enabled = useConfigValue("capture_enabled");
  const system = useSystemShortcuts();

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <SettingRow
        title={<Trans>Turn on screenshots and recordings</Trans>}
        description={
          <Trans>You can change this later in Settings › Screenshots.</Trans>
        }
        controlWidth="content"
      >
        {(labelProps) => (
          <Switch
            {...labelProps}
            checked={enabled}
            disabled={system.pending}
            onCheckedChange={(on) =>
              on
                ? void setSettingValue("capture_enabled", true)
                : system.disableCapture()
            }
          />
        )}
      </SettingRow>
      {enabled && (
        <>
          <CaptureShortcutRows actions={MAIN_ACTIONS} />
          <ReplaceSystemShortcuts />
          <p className="text-muted-foreground text-xs">
            <Trans>
              macOS asks you to allow Screen Recording the first time you
              capture.
            </Trans>
          </p>
        </>
      )}
      <OnboardingButton onClick={onContinue}>
        <Trans>Continue</Trans>
      </OnboardingButton>
    </div>
  );
}
