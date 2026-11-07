import { t } from "@lingui/core/macro";

import {
  getSummaryEligibility,
  MIN_TRANSCRIPT_CHARACTERS_FOR_SUMMARY,
  MIN_WORDS_FOR_SUMMARY,
  type SummaryEligibility,
  type SummaryEligibilitySkipCode,
} from "@anlg/utils/summary-eligibility";

import { countTranscriptWordCharacters } from "./summary-length";

export type EnhanceEligibilitySkipCode = SummaryEligibilitySkipCode;

export function getEligibility(
  transcripts: ReadonlyArray<{
    words: ReadonlyArray<{ text?: unknown }>;
  }>,
): SummaryEligibility {
  const eligibility = getSummaryEligibility({
    transcriptCount: transcripts.length,
    wordCount: transcripts.reduce(
      (total, transcript) => total + transcript.words.length,
      0,
    ),
    characterCount: countTranscriptWordCharacters(transcripts),
  });

  if (eligibility.eligible) {
    return eligibility;
  }

  return { ...eligibility, reason: describeIneligibility(eligibility) };
}

function describeIneligibility(
  eligibility: Extract<SummaryEligibility, { eligible: false }>,
): string {
  const { characterCount, wordCount } = eligibility;
  const minWords = MIN_WORDS_FOR_SUMMARY;
  const minCharacters = MIN_TRANSCRIPT_CHARACTERS_FOR_SUMMARY;

  if (eligibility.code === "no_transcript") {
    return t`No transcript recorded`;
  }

  if (wordCount < minWords) {
    return t`Not enough words recorded (${wordCount}/${minWords} minimum)`;
  }

  return t`Transcript too short to summarize (${characterCount}/${minCharacters} characters minimum)`;
}
