import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { getStoredSettingValues } from "~/settings/queries";
import { resolveConfigValue } from "~/shared/config";

/** Leaves `text` on the clipboard when "Keep last dictation on the clipboard" is on. */
export async function keepOnClipboard(text: string): Promise<void> {
  const stored = await getStoredSettingValues();
  if (resolveConfigValue("dictation_keep_on_clipboard", stored)) {
    await writeText(text);
  }
}
