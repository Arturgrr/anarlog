#!/usr/bin/env node
// Release helpers for .github/workflows/release.yaml. Values arrive through
// environment variables and arguments, never through workflow expressions.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageJsonPath = join(root, "apps/desktop/package.json");
const changelogDir = join(root, "packages/changelog/content/desktop");

// Stable `X.Y.Z` or beta `X.Y.Z-beta.N`. Semver orders 0.1.0-beta.2 after
// 0.1.0-beta.1 and 0.1.0 after every 0.1.0-beta.N, which is what the updater
// compares.
const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-beta\.(0|[1-9]\d*))?$/;

export const TAG_PREFIX = "desktop_v";

// A push to main releases whatever version apps/desktop/package.json holds;
// a manual run must name that same version.
export function resolveReleaseVersion({
  eventName,
  refName,
  inputVersion,
  packageVersion,
}) {
  if (eventName === "push" && refName !== "main") {
    throw new Error(`Releases run from pushes to main, not ${refName}.`);
  }
  const version = eventName === "push" ? packageVersion : inputVersion;
  if (!VERSION_PATTERN.test(version ?? "")) {
    throw new Error(
      `Expected a version such as 0.1.0-beta.1 or 0.1.0, got ${JSON.stringify(version ?? "")}.`,
    );
  }
  if (version !== packageVersion) {
    throw new Error(
      `apps/desktop/package.json is at ${packageVersion}. Bump it to ${version} on the release branch first.`,
    );
  }
  return version;
}

export function isBeta(version) {
  return version.includes("-beta.");
}

// Turns an in-app changelog entry into GitHub markdown: drops the frontmatter
// and renders <banner> tags, which GitHub would strip, as alerts.
export function changelogToGithubMarkdown(markdown) {
  const match = markdown.trim().match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
  const body = (match ? match[1] : markdown).trim();
  return body.replace(
    /<banner(?:\s+title="([^"]*)")?(?:\s+variant="([^"]*)")?\s*>([\s\S]*?)<\/banner>/g,
    (_, title, variant, content) =>
      [
        variant === "warning" ? "> [!WARNING]" : "> [!NOTE]",
        ...(title ? [`> **${title}**`, ">"] : []),
        ...content
          .trim()
          .split("\n")
          .map((line) => (line ? `> ${line}` : ">")),
      ].join("\n"),
  );
}

export function releaseNotes({ version, repository, changelog }) {
  const dmg = (arch) => `Librelog_${version}_${arch}.dmg`;
  const beta = isBeta(version)
    ? [
        "> [!WARNING]",
        "> This is a beta. Expect rough edges and report anything that breaks. Your notes and recordings stay on your Mac.",
        "",
      ]
    : [];

  return [
    ...beta,
    "## Download",
    "",
    "| Mac | File |",
    "| --- | --- |",
    `| Apple silicon (M1 or later) | \`${dmg("aarch64")}\` |`,
    `| Intel | \`${dmg("x64")}\` |`,
    "",
    "Requires macOS 15 Sequoia or later. To check your chip, open the Apple menu and choose **About This Mac**.",
    "",
    "## First launch",
    "",
    "Librelog is not notarized by Apple yet, so macOS blocks the first launch:",
    "",
    "1. Open the DMG and drag **Librelog** to **Applications**.",
    "2. Open Librelog. When macOS says it could not verify Librelog, click **Done**.",
    "3. Open **System Settings → Privacy & Security**, scroll to **Security**, and click **Open Anyway** next to the Librelog message. Confirm with your password or Touch ID, then click **Open Anyway** again.",
    "",
    "If macOS says Librelog is damaged, or you prefer Terminal, remove the download quarantine instead:",
    "",
    "```sh",
    "xattr -dr com.apple.quarantine /Applications/Librelog.app",
    "```",
    "",
    "You only do this once. Later versions install from inside the app.",
    "",
    "## Verify the download",
    "",
    "In the folder that holds the downloaded files, run:",
    "",
    "```sh",
    "shasum -a 256 -c SHA256SUMS.txt --ignore-missing",
    "```",
    "",
    "## Feedback",
    "",
    `Choose **Help → Report Bug** in Librelog, or [open an issue](https://github.com/${repository}/issues/new/choose). The app fills in your version, macOS version, and chip. Report security problems [privately](https://github.com/${repository}/security/advisories/new).`,
    "",
    "## What's new",
    "",
    changelogToGithubMarkdown(changelog),
    "",
  ].join("\n");
}

const UPDATER_ARCHES = { aarch64: "aarch64", x64: "x86_64" };

// Builds latest.json from the updater archives uploaded by every build job.
// URLs use the public download path so update checks do not count against the
// unauthenticated REST API limit.
export function updaterManifest({
  version,
  notes,
  pubDate,
  repository,
  tag,
  assets,
}) {
  const platforms = {};
  for (const [arch, platformArch] of Object.entries(UPDATER_ARCHES)) {
    const archive = assets.find((asset) =>
      asset.name.endsWith(`_${arch}.app.tar.gz`),
    );
    if (!archive) {
      throw new Error(`Missing the ${arch} updater archive.`);
    }
    const signature = assets.find(
      (asset) => asset.name === `${archive.name}.sig`,
    )?.content;
    if (!signature) {
      throw new Error(`Missing the signature for ${archive.name}.`);
    }
    const entry = {
      signature: signature.trim(),
      url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(archive.name)}`,
    };
    platforms[`darwin-${platformArch}`] = entry;
    platforms[`darwin-${platformArch}-app`] = entry;
  }
  return { version, notes, pub_date: pubDate, platforms };
}

function readPackageVersion() {
  return JSON.parse(readFileSync(packageJsonPath, "utf8")).version;
}

function changelogPath(version) {
  return join(changelogDir, `${version}.md`);
}

function main([command, ...args]) {
  const env = process.env;
  switch (command) {
    case "version": {
      const version = resolveReleaseVersion({
        eventName: env.EVENT_NAME,
        refName: env.REF_NAME,
        inputVersion: env.INPUT_VERSION,
        packageVersion: readPackageVersion(),
      });
      if (!existsSync(changelogPath(version))) {
        throw new Error(
          `Add release notes at packages/changelog/content/desktop/${version}.md first.`,
        );
      }
      process.stdout.write(`${version}\n`);
      return;
    }
    case "notes": {
      const [version] = args;
      process.stdout.write(
        releaseNotes({
          version,
          repository: env.GITHUB_REPOSITORY,
          changelog: readFileSync(changelogPath(version), "utf8"),
        }),
      );
      return;
    }
    case "updater-manifest": {
      const [version, directory] = args;
      const assets = readdirSync(directory).map((name) => ({
        name,
        content: name.endsWith(".sig")
          ? readFileSync(join(directory, name), "utf8")
          : undefined,
      }));
      const manifest = updaterManifest({
        version,
        notes: `See https://github.com/${env.GITHUB_REPOSITORY}/releases/tag/${TAG_PREFIX}${version}`,
        pubDate: new Date().toISOString(),
        repository: env.GITHUB_REPOSITORY,
        tag: `${TAG_PREFIX}${version}`,
        assets,
      });
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
      return;
    }
    default:
      throw new Error(
        "Usage: release.mjs version | notes <version> | updater-manifest <version> <dir>",
      );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
