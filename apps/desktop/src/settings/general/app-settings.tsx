import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { platform } from "@tauri-apps/plugin-os";

import { SettingSwitchRow } from "~/settings/setting-row";

export const privacyMessages = {
  title: msg`Privacy`,
};

interface SettingItem {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

interface AppSettingsViewProps {
  appStoreBuild: boolean;
  autostart: SettingItem;
  automaticUpdates: SettingItem;
  showAppInDock: SettingItem;
  showTrayIcon: SettingItem;
}

export function AppSettingsView({
  appStoreBuild,
  autostart,
  automaticUpdates,
  showAppInDock,
  showTrayIcon,
}: AppSettingsViewProps) {
  const currentPlatform = platform();
  const isMacos = currentPlatform === "macos";

  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="flex flex-col gap-4">
          {!appStoreBuild && (
            <>
              <SettingSwitchRow
                title={<Trans>Start Librelog at login</Trans>}
                description={
                  <Trans>Have Librelog ready when you sign in.</Trans>
                }
                checked={autostart.value}
                onChange={autostart.onChange}
              />
              <SettingSwitchRow
                title={<Trans>Automatically install updates</Trans>}
                description={
                  <Trans>
                    Stay current with updates installed the next time Librelog
                    opens.
                  </Trans>
                }
                checked={automaticUpdates.value}
                onChange={automaticUpdates.onChange}
              />
            </>
          )}
          {isMacos && (
            <SettingSwitchRow
              title={<Trans>Show app in Dock</Trans>}
              description={
                <Trans>
                  Show Librelog in the Dock and app switcher while its window is
                  open.
                </Trans>
              }
              checked={showAppInDock.value}
              onChange={showAppInDock.onChange}
            />
          )}
          <SettingSwitchRow
            title={<Trans>Show tray icon</Trans>}
            description={
              isMacos ? (
                <Trans>
                  Open Librelog from the menu bar, where it keeps running after
                  you close the window.
                </Trans>
              ) : undefined
            }
            checked={showTrayIcon.value}
            onChange={showTrayIcon.onChange}
          />
        </div>
      </section>
    </div>
  );
}
