<div align="center">

<img width="110" src="apps/desktop/src-tauri/icons/stable/128x128@2x.png" alt="Librelog icon" />

<h1>Librelog</h1>

<p>
    <b>A local-first AI meeting notepad.</b>
    <br />
    No account, no billing, no telemetry. Your audio, your notes, your keys.
  </p>

<p>
    <a href="https://github.com/Arturgrr/librelog/releases">Download</a>
    &nbsp;•&nbsp;
    <a href="docs">Docs</a>
    &nbsp;•&nbsp;
    <a href="https://github.com/Arturgrr/librelog/issues">Issues</a>
  </p>

</div>

Librelog is a community fork of [fastrepl/anarlog](https://github.com/fastrepl/anarlog). It keeps the desktop notepad, the local CLI, and the local MCP server, and removes everything that depended on a company-run backend: accounts, subscriptions, hosted AI, cloud sync, sharing, teams, and analytics. Every feature that works locally is available to everyone, with no gate.

Librelog takes notes in your meetings without sending a bot to the call. It records your device audio, transcribes it with a local model or the provider you choose, and keeps everything in a local SQLite database.

## What runs where

| Part of the workflow         | Where it happens                                                         |
| ---------------------------- | ------------------------------------------------------------------------ |
| Audio capture and recording  | Your device                                                              |
| Transcription                | A local model, or a provider you configure with your own API key         |
| AI summaries, titles, chat   | A local runtime (Ollama, LM Studio, …) or a provider with your own key   |
| Notes and transcript storage | Local SQLite plus local files                                            |
| Model downloads              | Directly from Hugging Face, only when you download a local model         |
| Updates                      | GitHub Releases of this repository                                       |

The app only talks to the AI provider you select, Hugging Face when you download a model, and GitHub Releases when it checks for updates.

## Install

Librelog is in public beta. Builds are published for macOS 15 Sequoia or later on [GitHub Releases](https://github.com/Arturgrr/librelog/releases/latest):

| Mac                         | Download                          |
| --------------------------- | --------------------------------- |
| Apple silicon (M1 or later) | `Librelog_<version>_aarch64.dmg` |
| Intel                       | `Librelog_<version>_x64.dmg`     |

Linux and Windows builds are not published yet; build from source (below).

Librelog has its own bundle identifier (`com.arturgrr.librelog`), data folder, and keychain entries. It does not read or import data from an installed Anarlog or Hyprnote app, and both can be installed side by side.

### First launch

Librelog is not notarized by Apple yet, so macOS blocks the first launch. On macOS 15 and later, right-clicking the app and choosing **Open** no longer bypasses this:

1. Open the DMG and drag **Librelog** to **Applications**.
2. Open Librelog. When macOS says it could not verify Librelog, click **Done**.
3. Open **System Settings → Privacy & Security**, scroll to **Security**, and click **Open Anyway** next to the Librelog message. Confirm with your password or Touch ID, then click **Open Anyway** again.

If macOS says Librelog is damaged, or you prefer Terminal, remove the download quarantine instead:

```bash
xattr -dr com.apple.quarantine /Applications/Librelog.app
```

To check a download, run `shasum -a 256 -c SHA256SUMS.txt --ignore-missing` in the folder that holds it; `SHA256SUMS.txt` is attached to every release.

### Updating

Librelog checks GitHub Releases for new versions. With **Settings → General → Automatically install updates** on, it installs them the next time it opens; you can also choose **Check for Updates** from the menu bar icon. Updates install from inside the app, so you only go through Open Anyway once.

### Known beta limitations

- Builds are not notarized. After an update, macOS may ask again for microphone, screen and system audio recording, accessibility, or keychain access.
- Soniqo, Apple Speech, and BYO-model on-device transcription need Apple silicon, and Apple Speech also needs macOS 26. On Intel Macs, use a provider with your own key or a local Deepgram-compatible server.
- There is no crash reporting or telemetry, so problems only reach the maintainer if you report them: choose **Help → Report Bug** or **Settings → General → Report a problem**. The issue form opens with your app version, macOS version, and chip filled in; nothing is sent until you submit it.

### Where your data lives

| What                                                       | Where                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| Notes, transcripts, recordings, settings, on-device models | `~/Library/Application Support/librelog`                 |
| App state, caches, and web view data                        | `~/Library/Application Support/com.arturgrr.librelog`, `~/Library/Caches/com.arturgrr.librelog`, `~/Library/WebKit/com.arturgrr.librelog` |
| Logs                                                       | `~/Library/Logs/com.arturgrr.librelog`                   |
| API keys                                                   | Keychain items for `com.arturgrr.librelog.secure-store`  |
| `librelog` CLI, which the app installs on launch           | `~/.local/bin/librelog`, `~/.local/bin/.librelog-cli`    |

### Uninstall or reset

1. Turn off **Settings → General → Start Librelog at login**, then choose **Quit Completely** from the menu bar icon.
2. Move `/Applications/Librelog.app` to the Trash.
3. To delete your data as well, export anything you want to keep first, then run:

   ```bash
   rm -rf ~/Library/Application\ Support/librelog \
     ~/Library/Application\ Support/com.arturgrr.librelog \
     ~/Library/Caches/com.arturgrr.librelog \
     ~/Library/Logs/com.arturgrr.librelog \
     ~/Library/WebKit/com.arturgrr.librelog \
     ~/.local/bin/librelog ~/.local/bin/.librelog-cli
   tccutil reset All com.arturgrr.librelog
   ```

   Then open **Keychain Access**, search for `com.arturgrr.librelog`, and delete the items it finds.

## Build from source

You need Node.js 22 or later, pnpm 11.1.1, Rust 1.94.0 (pinned in `rust-toolchain.toml`), and the [Tauri v2 system dependencies](https://v2.tauri.app/start/prerequisites/). Apple Silicon Macs also need Xcode with its Metal Toolchain component (`xcodebuild -downloadComponent MetalToolchain` on Xcode 26 and later). On Debian or Ubuntu, `bash scripts/setup-linux.sh` installs the toolchains and system packages.

```bash
git clone https://github.com/Arturgrr/librelog.git
cd librelog
pnpm install --frozen-lockfile
pnpm -F @anlg/ui build

# Run the desktop app in development mode
pnpm dev:desktop

# Or produce a local bundle (updater artifacts need the release signing key)
pnpm -F @anlg/desktop tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}'

# Install the CLI
cargo install --locked --path apps/cli
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and the development workflow.

## Repository map

| Path             | What lives there                                                    |
| ---------------- | ------------------------------------------------------------------- |
| `apps/desktop`   | Tauri v2 desktop app: React and TypeScript UI, Rust backend         |
| `apps/cli`       | Local CLI (`librelog`) and MCP server (`librelog mcp`)              |
| `plugins/*`      | Tauri plugins such as local STT, database access, and export        |
| `crates/*`       | Rust libraries for audio capture, transcription, storage, and more  |
| `packages/*`     | Shared TypeScript packages for the editor, database, UI, and SDK    |
| `crates/db-app`  | SQLite schema and migrations                                        |
| `skills/librelog` | Agent skill for the CLI and MCP server                             |
| `agent-plugins`  | Agent plugin that bundles the skill and the local MCP server        |
| `docs`           | Product and reference documentation (Mintlify)                      |

## Credits and license

Librelog is a fork of Anarlog, which [Fastrepl](https://github.com/fastrepl) created as Hyprnote and later released as [fastrepl/anarlog](https://github.com/fastrepl/anarlog) under the MIT license. Librelog is maintained by [Artur Guerra](https://github.com/Arturgrr) and is not affiliated with Fastrepl.

Licensed under the [MIT License](LICENSE). Third-party components keep their own licenses.
