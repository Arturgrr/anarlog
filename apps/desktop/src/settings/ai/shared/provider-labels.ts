import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

export const AFTER_RECORDING_BADGE = msg`After recording`;
export const SUBSCRIPTION_BADGE = msg`Subscription`;

// Generic provider names are English words, unlike brand names.
export function providerDisplayName(
  provider: { id: string; displayName: string },
  i18n: I18n,
) {
  if (provider.id === "custom") return i18n._(msg`Custom`);
  if (provider.id === "local_file") return i18n._(msg`BYO-model`);
  if (provider.id === "gguf") return i18n._(msg`Local models`);
  if (provider.id === "builtin") return i18n._(msg`Built-in models`);
  return provider.displayName;
}
