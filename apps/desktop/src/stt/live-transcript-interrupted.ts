import { t } from "@lingui/core/macro";

import type { DegradedError } from "@anlg/plugin-transcription";

import { PROVIDERS } from "~/settings/ai/stt/shared";

const LOCAL_PROVIDER_IDS = new Set(["soniqo", "apple_speech", "local_file"]);

function providerDisplayName(providerId: string | null | undefined) {
  if (!providerId) return null;
  return (
    PROVIDERS.find((provider) => provider.id === providerId)?.displayName ??
    null
  );
}

function isProviderSideStreamError(message: string) {
  return (
    /provider error/i.test(message) ||
    /code=Some\(4\d{3}\)/.test(message) ||
    /^[\w-]+: /.test(message)
  );
}

function getPausedSentence({
  degraded,
  sttProvider,
  online,
}: {
  degraded: DegradedError | null;
  sttProvider: string | null | undefined;
  online: boolean;
}) {
  const providerName =
    providerDisplayName(sttProvider) ?? t`the transcription service`;

  const isLocal = !!sttProvider && LOCAL_PROVIDER_IDS.has(sttProvider);

  if (!online && !isLocal) {
    return t`Live transcript paused because you're offline.`;
  }

  if (degraded?.type === "authentication_failed") {
    return t`Live transcript paused because ${providerName} rejected your API key.`;
  }

  if (degraded?.type === "provider_configuration") {
    return t`Live transcript paused because ${providerName} rejected the transcription settings.`;
  }

  if (
    degraded?.type === "stream_error" &&
    isProviderSideStreamError(degraded.message)
  ) {
    return t`Live transcript paused because ${providerName} is having an outage.`;
  }

  if (degraded) {
    if (isLocal) {
      return t`Live transcript paused because the local transcription model stopped responding.`;
    }
    return t`Live transcript paused because Librelog can't reach ${providerName}.`;
  }

  return t`Live transcript paused because ${providerName} stopped sending words.`;
}

export function getLiveTranscriptPausedMessage({
  degraded,
  sttProvider,
  online = typeof navigator === "undefined" ? true : navigator.onLine,
}: {
  degraded: DegradedError | null;
  sttProvider: string | null | undefined;
  online?: boolean;
}) {
  const paused = getPausedSentence({ degraded, sttProvider, online });
  const savedAudioNote = t`Your audio is still being saved, and the missing part will be filled in from the recording.`;
  return `${paused} ${savedAudioNote}`;
}
