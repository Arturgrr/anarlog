import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());

vi.mock("~/db", () => ({
  liveQueryClient: { execute },
  useLiveQuery: vi.fn(() => ({ data: undefined })),
}));

import {
  formatDictionaryTerms,
  normalizeKeywordList,
  parseDictionaryTermsJson,
  parseDictionaryTermsText,
} from "./keywords";
import {
  buildKeywords,
  buildKeywordSourceText,
  extractKeywordsFromMarkdown,
  getSessionKeywords,
} from "./useKeywords";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue([]);
});

describe("extractKeywordsFromMarkdown", () => {
  const cases: Array<{
    description: string;
    input: string;
    keywords: string[];
    keyphrases: string[];
  }> = [
    {
      description: "extracts hashtags from markdown",
      input: "This is #awesome and #cool stuff",
      keywords: ["awesome", "cool"],
      keyphrases: [],
    },
    {
      description: "handles unicode hashtags",
      input: "#日本語 #한글 #Español",
      keywords: ["日本語", "한글", "Español"],
      keyphrases: [],
    },
    {
      description: "excludes code blocks and inline code",
      input:
        "Use the `useState` hook\n```js\nconst value = 1;\n```\nKeep reading for keywords",
      keywords: ["hook", "keywords"],
      keyphrases: [],
    },
    {
      description: "extracts hashtags and keywords from markdown",
      input:
        "# Hello World\n\nThis is a #test with some #keywords and important content",
      keywords: ["test", "keywords", "World", "content"],
      keyphrases: [],
    },
    {
      description: "removes code blocks before processing",
      input:
        "Text before\n```js\nconst x = 1;\n```\nText after with important keywords",
      keywords: ["Text", "keywords"],
      keyphrases: [],
    },
    {
      description: "extracts keywords from natural language",
      input:
        "Artificial intelligence and machine learning are transforming technology",
      keywords: ["technology"],
      keyphrases: ["Artificial intelligence"],
    },
    {
      description: "extracts keyphrases",
      input: "I'm learning about machine learning and data science in depth",
      keywords: [],
      keyphrases: ["data science"],
    },
    {
      description: "handles complex real-world markdown",
      input: `
# Meeting Notes

We discussed machine learning and its applications in production systems.

\`\`\`python
def hello():
    print("hello")
\`\`\`

Key points:
- Review the #projectA deliverables
- Implement data science solutions
- Team collaboration is essential

Next steps: testing and validation of the algorithms
    `,
      keywords: ["projectA"],
      keyphrases: ["production systems"],
    },
    {
      description: "handles empty text gracefully",
      input: "",
      keywords: [],
      keyphrases: [],
    },
    {
      description: "filters single-character tokens",
      input: "a b c",
      keywords: [],
      keyphrases: [],
    },
    {
      description: "comma & space",
      input: "yujonglee,john, atila",
      keywords: ["yujonglee", "john", "atila"],
      keyphrases: [],
    },
  ];

  it.each(cases)("$description", ({ input, keywords, keyphrases }) => {
    const result = extractKeywordsFromMarkdown(input);
    expect(result.keywords).toEqual(expect.arrayContaining(keywords));
    expect(result.keyphrases).toEqual(expect.arrayContaining(keyphrases));
  });
});

describe("buildKeywordSourceText", () => {
  it("includes session note, title, and event metadata", () => {
    expect(
      buildKeywordSourceText({
        rawMd: "Discuss product launch",
        title: "Erebor sync",
        eventJson: JSON.stringify({
          title: "OpenWorld review",
          description: "Airborne Brothers follow-up",
          location: "Zoom",
        }),
      }),
    ).toBe(
      [
        "Discuss product launch",
        "Erebor sync",
        "OpenWorld review",
        "Airborne Brothers follow-up",
        "Zoom",
      ].join("\n"),
    );
  });
});

describe("getSessionKeywords", () => {
  it("builds keywords from the current session snapshot", async () => {
    execute.mockResolvedValue([
      {
        raw_md: "Discuss #Launch and production systems",
        title: "Erebor sync",
        event_json: JSON.stringify({
          title: "OpenWorld review",
          description: "Airborne Brothers follow-up",
          location: "Zoom",
        }),
        participant_names_json: "[]",
        event_participants_json: "[]",
      },
    ]);

    await expect(
      getSessionKeywords({
        sessionId: "session-1",
        dictionaryTerms: ["Librelog"],
      }),
    ).resolves.toEqual(expect.arrayContaining(["Librelog", "Launch"]));
  });

  it("prioritizes mapped participants and attached event attendees", async () => {
    execute.mockResolvedValue([
      {
        raw_md: "Discuss #Launch and production systems",
        title: "Erebor sync",
        event_json: JSON.stringify({
          title: "OpenWorld review",
          description: "Airborne Brothers follow-up",
          location: "Zoom",
        }),
        participant_names_json: JSON.stringify(["Alice Kim"]),
        event_participants_json: JSON.stringify([
          { name: "Alice Kim", email: "alice@example.com" },
          { name: "Mina Park", email: "mina@example.com" },
          {
            name: "John Jeong",
            email: "john@example.com",
            is_current_user: true,
          },
        ]),
      },
    ]);

    const result = await getSessionKeywords({
      sessionId: "session-1",
      dictionaryTerms: ["Librelog"],
    });

    expect(result.slice(0, 3)).toEqual(["Alice Kim", "Mina Park", "Librelog"]);
    expect(result).toEqual(expect.arrayContaining(["Launch"]));
    expect(result).not.toContain("John Jeong");
  });

  it("never sends the local user's name as a transcription keyword", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE sessions (
          id TEXT, owner_user_id TEXT, title TEXT, event_json TEXT,
          event_id TEXT, deleted_at TEXT
        );
        CREATE TABLE session_documents (
          id TEXT, kind TEXT, body TEXT, deleted_at TEXT
        );
        CREATE TABLE session_participants (
          id TEXT, session_id TEXT, human_id TEXT, display_name TEXT,
          source TEXT, deleted_at TEXT
        );
        CREATE TABLE humans (id TEXT, name TEXT, deleted_at TEXT);
        CREATE TABLE events (
          id TEXT, tracking_id_event TEXT, calendar_id TEXT,
          participants_json TEXT, started_at TEXT, deleted_at TEXT
        );
        INSERT INTO sessions VALUES
          ('session-1', 'owner-1', 'Sync', '{}', '', NULL);
        INSERT INTO humans VALUES
          ('owner-1', 'Ada Owner', NULL),
          ('human-1', 'Alice Kim', NULL);
        INSERT INTO session_participants VALUES
          ('mapping-self', 'session-1', 'owner-1', 'Ada Owner', 'manual', NULL),
          ('mapping-1', 'session-1', 'human-1', '', 'manual', NULL);
      `);
      execute.mockImplementationOnce((sql: string, params: unknown[]) =>
        Promise.resolve(db.prepare(sql).all(...(params as string[]))),
      );

      const result = await getSessionKeywords({
        sessionId: "session-1",
        dictionaryTerms: [],
      });

      expect(result).toContain("Alice Kim");
      expect(result).not.toContain("Ada Owner");
    } finally {
      db.close();
    }
  });
});

describe("buildKeywords", () => {
  it("dedupes higher-priority hints and caps the result", () => {
    const result = buildKeywords({
      rawMd: "",
      title: "",
      eventJson: "",
      sessionParticipantTerms: ["Alice Kim"],
      eventParticipantTerms: ["alice kim", "Mina Park"],
      dictionaryTerms: Array.from(
        { length: 60 },
        (_, index) => `Term ${index}`,
      ),
    });

    expect(result).toHaveLength(50);
    expect(result.slice(0, 4)).toEqual([
      "Alice Kim",
      "Mina Park",
      "Term 0",
      "Term 1",
    ]);
    expect(result).not.toContain("alice kim");
  });
});

describe("dictionary term helpers", () => {
  it.each([
    {
      name: "parses stored JSON dictionary terms",
      run: () => parseDictionaryTermsJson(JSON.stringify(["Librelog", "Char"])),
      expected: ["Librelog", "Char"],
    },
    {
      name: "parses an array payload and drops duplicate spellings",
      run: () => parseDictionaryTermsJson(["Librelog", " librelog "]),
      expected: ["Librelog"],
    },
    {
      name: "returns no terms for malformed JSON",
      run: () => parseDictionaryTermsJson("not-json"),
      expected: [],
    },
    {
      name: "parses newline and comma separated terms",
      run: () =>
        parseDictionaryTermsText("Librelog\nFastConformer, Parakeet TDT"),
      expected: ["Librelog", "FastConformer", "Parakeet TDT"],
    },
    {
      name: "normalizes duplicate terms while preserving first spelling",
      run: () => normalizeKeywordList(["Librelog", " librelog ", "Parakeet"]),
      expected: ["Librelog", "Parakeet"],
    },
  ])("$name", ({ run, expected }) => {
    expect(run()).toEqual(expected);
  });

  it("formats stored terms one per line", () => {
    expect(formatDictionaryTerms(["Librelog", "Parakeet TDT"])).toBe(
      "Librelog\nParakeet TDT",
    );
  });
});
