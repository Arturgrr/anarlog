import type { DegradedError } from "@anlg/plugin-transcription";

import { PROVIDERS } from "~/settings/ai/stt/shared";

const SAVED_AUDIO_NOTE =
  "Your audio is still being saved, and the missing part will be filled in from the recording.";

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

function getPauseCause({
  degraded,
  sttProvider,
  online,
}: {
  degraded: DegradedError | null;
  sttProvider: string | null | undefined;
  online: boolean;
}) {
  const providerName =
    providerDisplayName(sttProvider) ?? "the transcription service";

  const isLocal = !!sttProvider && LOCAL_PROVIDER_IDS.has(sttProvider);

  if (!online && !isLocal) {
    return "you're offline";
  }

  if (degraded?.type === "authentication_failed") {
    return `${providerName} rejected your API key`;
  }

  if (degraded?.type === "provider_configuration") {
    return `${providerName} rejected the transcription settings`;
  }

  if (
    degraded?.type === "stream_error" &&
    isProviderSideStreamError(degraded.message)
  ) {
    return `${providerName} is having an outage`;
  }

  if (degraded) {
    if (isLocal) {
      return "the local transcription model stopped responding";
    }
    return `Librelog can't reach ${providerName}`;
  }

  return `${providerName} stopped sending words`;
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
  const cause = getPauseCause({ degraded, sttProvider, online });
  return `Live transcript paused because ${cause}. ${SAVED_AUDIO_NOTE}`;
}
