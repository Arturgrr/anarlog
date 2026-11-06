import { Trans } from "@lingui/react/macro";
import { platform } from "@tauri-apps/plugin-os";

import { SettingSwitchRow } from "~/settings/setting-row";

interface SettingItem {
  value: boolean;
  onChange: (value: boolean) => void;
}

export function MeetingSettingsView({
  autoStopMeetings,
  floatingBar,
  meetingDisclosureAutoPost,
  captureMeetingChat,
  captureSharedScreens,
}: {
  autoStopMeetings: SettingItem;
  floatingBar: SettingItem;
  meetingDisclosureAutoPost: SettingItem;
  captureMeetingChat: SettingItem;
  captureSharedScreens: SettingItem;
}) {
  const currentPlatform = platform();
  const supportsMeetingAx =
    currentPlatform === "macos" || currentPlatform === "linux";
  const supportsMicDetection = currentPlatform !== "windows";
  const supportsScreenCapture =
    currentPlatform === "macos" || currentPlatform === "windows";

  return (
    <div className="flex flex-col gap-4">
      {supportsMicDetection && (
        <SettingSwitchRow
          title={<Trans>Stop when meeting ends</Trans>}
          description={<Trans>Stop listening when your call ends.</Trans>}
          checked={autoStopMeetings.value}
          onChange={autoStopMeetings.onChange}
        />
      )}
      {supportsMeetingAx && (
        <>
          <SettingSwitchRow
            title={<Trans>Post recording disclosure in meeting chat</Trans>}
            description={
              <Trans>
                Tell participants when listening starts; this does not confirm
                consent.
              </Trans>
            }
            checked={meetingDisclosureAutoPost.value}
            onChange={meetingDisclosureAutoPost.onChange}
          />
          <SettingSwitchRow
            title={<Trans>Capture meeting chat in Memos</Trans>}
            description={
              <Trans>
                Save visible chat from supported meetings using Accessibility.
              </Trans>
            }
            checked={captureMeetingChat.value}
            onChange={captureMeetingChat.onChange}
          />
        </>
      )}
      {supportsScreenCapture && (
        <SettingSwitchRow
          title={<Trans>Capture shared screens in Memos</Trans>}
          description={
            <Trans>
              Save slides and screens others share in meetings. Requires Screen
              Recording.
            </Trans>
          }
          checked={captureSharedScreens.value}
          onChange={captureSharedScreens.onChange}
        />
      )}
      <SettingSwitchRow
        title={<Trans>Show floating bar</Trans>}
        description={
          <Trans>Control listening without reopening Librelog.</Trans>
        }
        checked={floatingBar.value}
        onChange={floatingBar.onChange}
      />
    </div>
  );
}
