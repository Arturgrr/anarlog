import { t } from "@lingui/core/macro";
import { platform } from "@tauri-apps/plugin-os";

// "Mac" is only right on macOS; everywhere else the same copy says "computer".
const isMac = () => platform() === "macos";

export const deviceCopy = {
  onThisDevice: () => (isMac() ? t`On this Mac` : t`On this computer`),
  notAvailable: () =>
    isMac() ? t`Not available on this Mac` : t`Not available on this computer`,
  notAvailableSentence: () =>
    isMac()
      ? t`Not available on this Mac.`
      : t`Not available on this computer.`,
  bestForThisDevice: () =>
    isMac() ? t`Best for this Mac` : t`Best for this computer`,
  modelFilesRemoved: () =>
    isMac()
      ? t`The model files are removed from this Mac. You can download them again later.`
      : t`The model files are removed from this computer. You can download them again later.`,
  installModelOrConnectCloud: () =>
    isMac()
      ? t`Install a model on your Mac or connect a cloud provider. It’s the same list as Settings › Transcription.`
      : t`Install a model on your computer or connect a cloud provider. It’s the same list as Settings › Transcription.`,
  runModelSignInOrApiKey: () =>
    isMac()
      ? t`Run a model on your Mac, sign in with a subscription or use an API key. It’s the same list as Settings › Intelligence.`
      : t`Run a model on your computer, sign in with a subscription or use an API key. It’s the same list as Settings › Intelligence.`,
};
