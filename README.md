<div align="center">

<img width="110" src="apps/desktop/src-tauri/icons/stable/128x128@2x.png" alt="Anarlog icon" />

<h1>Anarlog</h1>

<p>
    <b>A local-first AI meeting notepad.</b>
    <br />
    No account, no billing, no telemetry. Your audio, your notes, your keys.
  </p>

<p>
    <a href="https://github.com/Arturgrr/anarlog/releases">Download</a>
    &nbsp;•&nbsp;
    <a href="docs">Docs</a>
    &nbsp;•&nbsp;
    <a href="https://github.com/Arturgrr/anarlog/issues">Issues</a>
  </p>

</div>

This repository is a community fork of [fastrepl/anarlog](https://github.com/fastrepl/anarlog). It keeps the desktop notepad, the local CLI, and the local MCP server, and removes everything that depended on a company-run backend: accounts, subscriptions, hosted AI, cloud sync, sharing, teams, and analytics. Every feature that works locally is available to everyone, with no gate.

Anarlog takes notes in your meetings without sending a bot to the call. It records your device audio, transcribes it with a local model or the provider you choose, and keeps everything in a local SQLite database.

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

Download the latest macOS build from [GitHub Releases](https://github.com/Arturgrr/anarlog/releases). Builds are ad-hoc signed and not notarized, so macOS asks for confirmation on first launch: right-click the app and choose **Open**, or run `xattr -dr com.apple.quarantine /Applications/Anarlog.app`.

Linux and Windows builds are not published yet; build from source (below).

> [!WARNING]
> This fork still uses the upstream bundle identifier (`com.hyprnote.stable`). If you install both the upstream app and this fork, they share the same data directory and keychain entries.

## Build from source

You need Node.js 22 or later, pnpm 11.1.1, Rust 1.94.0 (pinned in `rust-toolchain.toml`), and the [Tauri v2 system dependencies](https://v2.tauri.app/start/prerequisites/). Apple Silicon Macs also need Xcode with its Metal Toolchain component (`xcodebuild -downloadComponent MetalToolchain` on Xcode 26 and later). On Debian or Ubuntu, `bash scripts/setup-linux.sh` installs the toolchains and system packages.

```bash
git clone https://github.com/Arturgrr/anarlog.git
cd anarlog
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
| `apps/cli`       | Local CLI (`anarlog`) and MCP server (`anarlog mcp`)                |
| `plugins/*`      | Tauri plugins such as local STT, database access, export, calendar  |
| `crates/*`       | Rust libraries for audio capture, transcription, storage, and more  |
| `packages/*`     | Shared TypeScript packages for the editor, database, UI, and SDK    |
| `crates/db-app`  | SQLite schema and migrations                                        |
| `skills/anarlog` | Agent skill for the CLI and MCP server                              |
| `agent-plugins`  | Agent plugin that bundles the skill and the local MCP server        |
| `docs`           | Product and reference documentation (Mintlify)                      |

## Credits and license

Anarlog was created by [Fastrepl](https://github.com/fastrepl) as Hyprnote and later released as [fastrepl/anarlog](https://github.com/fastrepl/anarlog) under the MIT license. This fork is maintained by [Artur Guerra](https://github.com/Arturgrr) and is not affiliated with Fastrepl.

Licensed under the [MIT License](LICENSE). Third-party components keep their own licenses.
