import { Effect, Option, pipe } from "effect";
import type { UnknownException } from "effect/Cause";
import { toString } from "nlcst-to-string";
import retextEnglish from "retext-english";
import type { Keyphrase, Keyword } from "retext-keywords";
import retextKeywords from "retext-keywords";
import retextPos from "retext-pos";
import retextStringify from "retext-stringify";
import { unified } from "unified";
import type { VFile } from "vfile";

import { liveQueryClient } from "~/db";
import { normalizeKeywordList } from "~/stt/keywords";

const MAX_TRANSCRIPTION_HINTS = 50;

type KeywordSnapshotSqlRow = {
  raw_md: string;
  title: string;
  participant_names_json: string;
};

export async function getSessionKeywords({
  sessionId,
  dictionaryTerms,
}: {
  sessionId: string;
  dictionaryTerms: string[];
}): Promise<string[]> {
  const [snapshot] = await liveQueryClient.execute<KeywordSnapshotSqlRow>(
    `
      SELECT
        COALESCE(note.body, '') AS raw_md,
        session.title,
        COALESCE((
          SELECT json_group_array(name)
          FROM (
            SELECT COALESCE(NULLIF(human.name, ''), participant.display_name) AS name
            FROM session_participants AS participant
            LEFT JOIN humans AS human
              ON human.id = participant.human_id
              AND human.deleted_at IS NULL
            WHERE participant.session_id = session.id
              AND participant.source <> 'excluded'
              AND participant.deleted_at IS NULL
              AND COALESCE(NULLIF(human.name, ''), participant.display_name) <> ''
            ORDER BY name, participant.id
          )
        ), '[]') AS participant_names_json
      FROM sessions AS session
      LEFT JOIN session_documents AS note
        ON note.id = session.id
        AND note.kind = 'note'
        AND note.deleted_at IS NULL
      WHERE session.id = ? AND session.deleted_at IS NULL
      LIMIT 1
    `,
    [sessionId],
  );

  return buildKeywords({
    rawMd: snapshot?.raw_md,
    title: snapshot?.title,
    sessionParticipantTerms: parseStringList(snapshot?.participant_names_json),
    dictionaryTerms,
  });
}

export function buildKeywords({
  rawMd,
  title,
  sessionParticipantTerms = [],
  dictionaryTerms,
}: {
  rawMd: unknown;
  title: unknown;
  sessionParticipantTerms?: string[];
  dictionaryTerms: string[];
}) {
  const sourceText = buildKeywordSourceText({ rawMd, title });
  const { keywords, keyphrases } =
    sourceText.length > 0
      ? extractKeywordsFromMarkdown(sourceText)
      : { keywords: [], keyphrases: [] };

  return normalizeKeywordList([
    ...sessionParticipantTerms,
    ...dictionaryTerms,
    ...keywords,
    ...keyphrases,
  ]).slice(0, MAX_TRANSCRIPTION_HINTS);
}

export function buildKeywordSourceText({
  rawMd,
  title,
}: {
  rawMd: unknown;
  title: unknown;
}): string {
  return [stringValue(rawMd), stringValue(title)]
    .filter((value) => value.length > 0)
    .join("\n");
}

export const extractKeywordsFromMarkdown = (
  markdown: string,
): { keywords: string[]; keyphrases: string[] } =>
  pipe(
    Effect.succeed(markdown),
    Effect.map(removeCodeBlocks),
    Effect.map((text) => ({
      hashtags: extractHashtags(text),
      cleaned: stripMarkdownFormatting(text),
    })),
    Effect.flatMap(({ cleaned, hashtags }) =>
      cleaned.trim().length === 0
        ? Effect.succeed({ keywords: hashtags, keyphrases: [] })
        : pipe(
            processMarkdown(cleaned),
            Effect.map((file) => gatherKeywords(file, hashtags)),
            Effect.orElse(() =>
              Effect.succeed({
                keywords: hashtags,
                keyphrases: [],
              }),
            ),
          ),
    ),
    Effect.runSync,
  );

const processMarkdown = (
  markdown: string,
): Effect.Effect<VFile, UnknownException, never> =>
  Effect.try(() =>
    unified()
      .use(retextEnglish)
      .use(retextPos)
      .use(retextKeywords, { maximum: 50 })
      .use(retextStringify)
      .processSync(markdown),
  );

const gatherKeywords = (
  file: VFile,
  hashtags: string[],
): { keywords: string[]; keyphrases: string[] } => {
  const keywords = pipe(
    Option.fromNullable(file.data.keywords),
    Option.map((entries) => entries.flatMap(extractKeywordMatches)),
    Option.getOrElse(() => [] as string[]),
  );

  const keyphrases = pipe(
    Option.fromNullable(file.data.keyphrases),
    Option.map((entries) => entries.flatMap(extractKeyphraseMatches)),
    Option.getOrElse(() => [] as string[]),
  );

  return {
    keywords: [...hashtags, ...keywords].filter(
      (keyword) => keyword.length >= 2,
    ),
    keyphrases: keyphrases.filter((phrase) => phrase.length >= 2),
  };
};

const extractKeywordMatches = (keyword: Keyword): string[] =>
  keyword.matches.flatMap((match) => {
    const text = toString(match.node).trim();
    return text.length > 0 ? [text] : [];
  });

const extractKeyphraseMatches = (phrase: Keyphrase): string[] =>
  phrase.matches.flatMap((match) => {
    const text = toString(match.nodes).trim();
    return text.length > 0 ? [text] : [];
  });

const stringValue = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const parseStringList = (value: unknown): string[] => {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
};

const removeCodeBlocks = (text: string): string =>
  text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]+`/g, "");

const extractHashtags = (text: string): string[] =>
  Array.from(text.matchAll(/#([\p{L}\p{N}_]+)/gu), (match) => match[1]).filter(
    Boolean,
  );

const stripMarkdownFormatting = (text: string): string =>
  text.replace(/[#*_~`[\]()]/g, " ");
