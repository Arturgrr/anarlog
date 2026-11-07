import assert from "node:assert/strict";
import test from "node:test";

import {
  releaseNotes,
  resolveReleaseVersion,
  updaterManifest,
} from "./release.mjs";

test("release versions come from the app on main or from the input", () => {
  assert.equal(
    resolveReleaseVersion({
      eventName: "push",
      refName: "main",
      packageVersion: "0.1.0-beta.2",
    }),
    "0.1.0-beta.2",
  );
  assert.throws(() =>
    resolveReleaseVersion({
      eventName: "push",
      refName: "main",
      packageVersion: "0.1.0-rc.1",
    }),
  );
  assert.equal(
    resolveReleaseVersion({
      eventName: "workflow_dispatch",
      inputVersion: "1.2.3",
      packageVersion: "1.2.3",
    }),
    "1.2.3",
  );

  for (const inputVersion of [
    "v0.1.0",
    "0.1",
    "0.1.0-beta",
    "0.1.0-beta.01",
    "0.1.0-rc.1",
    "0.1.0-beta.1\necho",
    "$(id)",
  ]) {
    assert.throws(() =>
      resolveReleaseVersion({
        eventName: "workflow_dispatch",
        inputVersion,
        packageVersion: inputVersion,
      }),
    );
  }

  assert.throws(
    () =>
      resolveReleaseVersion({
        eventName: "push",
        refName: "integration/local-first",
        packageVersion: "0.1.0-beta.1",
      }),
    /pushes to main/,
  );
  assert.throws(
    () =>
      resolveReleaseVersion({
        eventName: "workflow_dispatch",
        inputVersion: "0.1.0-beta.2",
        packageVersion: "0.1.0-beta.1",
      }),
    /Bump it to 0\.1\.0-beta\.2/,
  );
});

test("release notes explain the macOS 15 first launch and include the changelog", () => {
  const notes = releaseNotes({
    version: "0.1.0-beta.1",
    repository: "Arturgrr/librelog",
    changelog:
      '---\ndate: "2026-11-06"\nsummary: "First beta."\n---\n\n<banner title="Welcome">\nLine one.\n\nLine two.\n</banner>\n\n## Hello\n',
  });

  assert.match(notes, /This is a beta/);
  assert.match(notes, /Librelog_0\.1\.0-beta\.1_aarch64\.dmg/);
  assert.match(notes, /Apple silicon/);
  assert.doesNotMatch(notes, /_x64\.dmg/);
  assert.match(notes, /Privacy & Security.*Open Anyway/);
  assert.doesNotMatch(notes, /right-click/i);
  assert.match(
    notes,
    /## What's new\n\n> \[!NOTE\]\n> \*\*Welcome\*\*\n>\n> Line one\.\n>\n> Line two\.\n\n## Hello\n$/,
  );
  assert.doesNotMatch(notes, /summary:|<banner/);
  assert.doesNotMatch(
    releaseNotes({ version: "0.1.0", repository: "a/b", changelog: "" }),
    /This is a beta/,
  );
});

test("the updater manifest points Apple silicon Macs at the public download URL", () => {
  const manifest = updaterManifest({
    version: "0.1.0-beta.1",
    notes: "notes",
    pubDate: "2026-11-06T00:00:00.000Z",
    repository: "Arturgrr/librelog",
    tag: "desktop_v0.1.0-beta.1",
    assets: [
      { name: "Librelog_0.1.0-beta.1_aarch64.dmg" },
      { name: "Librelog_0.1.0-beta.1_aarch64.app.tar.gz" },
      {
        name: "Librelog_0.1.0-beta.1_aarch64.app.tar.gz.sig",
        content: "arm-signature\n",
      },
    ],
  });

  const arm = {
    signature: "arm-signature",
    url: "https://github.com/Arturgrr/librelog/releases/download/desktop_v0.1.0-beta.1/Librelog_0.1.0-beta.1_aarch64.app.tar.gz",
  };
  assert.deepEqual(manifest, {
    version: "0.1.0-beta.1",
    notes: "notes",
    pub_date: "2026-11-06T00:00:00.000Z",
    platforms: {
      "darwin-aarch64": arm,
      "darwin-aarch64-app": arm,
    },
  });
});

test("the updater manifest refuses to publish without a signed archive", () => {
  const base = {
    version: "0.1.0-beta.1",
    notes: "",
    pubDate: "",
    repository: "a/b",
    tag: "t",
  };
  assert.throws(
    () =>
      updaterManifest({
        ...base,
        assets: [{ name: "L_aarch64.dmg" }],
      }),
    /aarch64 updater archive/,
  );
  assert.throws(
    () =>
      updaterManifest({
        ...base,
        assets: [{ name: "L_aarch64.app.tar.gz" }],
      }),
    /signature for L_aarch64/,
  );
});
