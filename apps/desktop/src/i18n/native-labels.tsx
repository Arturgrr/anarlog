import { useLingui } from "@lingui/react/macro";
import { useEffect } from "react";

import { commands as permissionsCommands } from "@anlg/plugin-permissions";
import { commands as trayCommands, type TrayLabels } from "@anlg/plugin-tray";

// Rust fills these in, so the native side can use the translated templates.
const app = "{app}";
const version = "{version}";
const error = "{error}";

export function NativeLabelsSync() {
  const { t } = useLingui();

  useEffect(() => {
    const labels: TrayLabels = {
      openApp: t`Open ${app}`,
      startMeeting: t`Start a new meeting`,
      pasteLastDictation: t`Paste last dictation`,
      captureArea: t`Capture Area`,
      recordScreen: t`Record Screen`,
      settings: t`Settings`,
      checkForUpdates: t`Check for Updates`,
      downloadingUpdate: t`Downloading...`,
      restartToApplyUpdate: t`Restart to Apply Update`,
      hide: t`Hide`,
      quit: t`Quit`,
      quitCompletely: t`Quit Completely…`,
      quitCompletelyTitle: t`Quit ${app} Completely?`,
      quitCompletelyMessage: t`${app} will stop running in the background.`,
      quitCompletelyConfirm: t`Quit Completely`,
      cancel: t`Cancel`,
      aboutApp: t`About ${app}`,
      copy: t`Copy`,
      newNote: t`New Note`,
      reportBug: t`Report Bug`,
      suggestFeature: t`Suggest Feature`,
      fileMenu: t`File`,
      editMenu: t`Edit`,
      viewMenu: t`View`,
      windowMenu: t`Window`,
      helpMenu: t`Help`,
      services: t`Services`,
      hideApp: t`Hide ${app}`,
      hideOthers: t`Hide Others`,
      showAll: t`Show All`,
      closeWindow: t`Close Window`,
      undo: t`Undo`,
      redo: t`Redo`,
      cut: t`Cut`,
      paste: t`Paste`,
      selectAll: t`Select All`,
      fullscreen: t`Toggle Full Screen`,
      minimize: t`Minimize`,
      zoom: t`Zoom`,
      updateAvailableMessage: t`Update v${version} is available!`,
      updateAvailableTitle: t`Update Available`,
      download: t`Download`,
      later: t`Later`,
      updateFailedTitle: t`Update Failed`,
      installFailedMessage: t`Failed to install update: ${error}`,
      downloadFailedMessage: t`Failed to download update: ${error}`,
      noUpdatesMessage: t`There are currently no updates available.`,
      updateCheckFailedTitle: t`Update Check Failed`,
      checkFailedMessage: t`Failed to check for updates: ${error}`,
    };

    const report = (reason: unknown) =>
      console.error("[i18n] failed to update native labels", reason);

    void trayCommands
      .setTrayLabels(labels)
      .then((result) => {
        if (result.status === "error") report(result.error);
      })
      .catch(report);
    void permissionsCommands
      .setPermissionAssistantLabels({
        allowAccessibility: t`Allow Accessibility`,
        dragHint: t`Drag the app below into the list above.`,
        dismiss: t`Dismiss`,
      })
      .then((result) => {
        if (result.status === "error") report(result.error);
      })
      .catch(report);
  }, [t]);

  return null;
}
