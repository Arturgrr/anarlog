const CHANGELOG_DIR = "../../../../packages/changelog/content/desktop";

const bundledChangelogs = import.meta.glob<string>(
  "../../../../packages/changelog/content/desktop/*.md",
  { query: "?raw", import: "default" },
);

export async function loadBundledChangelog(
  version: string,
): Promise<string | null> {
  const load = bundledChangelogs[`${CHANGELOG_DIR}/${version}.md`];
  return load ? load() : null;
}
