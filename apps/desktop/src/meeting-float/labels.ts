import { t } from "@lingui/core/macro";

import type { FloatingBarLabels } from "@anlg/plugin-windows";

export function getFloatingBarLabels(
  transcriptNotice: string | null | undefined,
): FloatingBarLabels {
  const notice = transcriptNotice ?? t`Recording needs attention`;

  return {
    stop: t`Stop`,
    stopListening: t`Stop listening`,
    reconnectingStopListening: t`Reconnecting live transcription; stop listening`,
    errorStopListening: t`${notice}; stop listening`,
    errorHelp: t`${notice}. Open Librelog to retry or change devices.`,
    collapseTranscript: t`Collapse live transcript`,
    expandTranscript: t`Expand live transcript`,
    goToBottom: t`Go to bottom`,
    scrollTranscriptToBottom: t`Scroll transcript to bottom`,
    overlappingSpeech: t`Overlapping speech`,
    settingsTitle: t`Floating bar`,
    closeSettings: t`Close settings`,
    barOpacity: t`Bar opacity`,
    showTranscript: t`Show transcript`,
    hideTranscript: t`Hide transcript`,
  };
}
