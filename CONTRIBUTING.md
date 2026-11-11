# Contributing

Issues, pull requests, bug reports, and documentation fixes are welcome.

## Before you start

- Search existing [issues](https://github.com/Arturgrr/librelog/issues) and pull requests before starting a large change.
- Keep changes focused. Add tests for behavior that can regress.
- Never commit credentials, meeting content, or other private data.
- The app must stay local-first: no accounts, telemetry, or calls to services other than the user's chosen AI provider, Hugging Face model downloads, and GitHub Releases for updates.
- Product, CLI, and MCP behavior is documented in [`docs/`](docs). Use this file and the repository's `AGENTS.md` files for development guidance.

## Set up the repository

You need:

- Node.js 22 or later
- pnpm 11.1.1
- Rust 1.94.0
- [process-compose](https://f1bonacc1.github.io/process-compose/installation/) 1.122.0 or later (`brew install process-compose` on macOS)
- The [Tauri v2 system dependencies](https://v2.tauri.app/start/prerequisites/)
- On Apple Silicon Macs, Xcode with its Metal Toolchain component. The Command Line Tools alone cannot compile the MLX shader library used by local transcription. Xcode 26 and later install the component separately with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -downloadComponent MetalToolchain`; Xcode does not need to be selected with `xcode-select`.

On Debian or Ubuntu, install the supported toolchains and system packages with:

```bash
bash scripts/setup-linux.sh
```

Then install the workspace:

```bash
pnpm install --frozen-lockfile
```

## Run the desktop app

```bash
pnpm dev:desktop
```

Process Compose builds the shared UI through Turbo, starts the app, and writes logs under `.process-compose/`. The desktop app needs no secrets. Use the Process Compose TUI to view logs or restart processes; it is disabled automatically without a terminal, or with `PC_DISABLE_TUI=1`.

If the checkout path contains spaces, set `CARGO_TARGET_DIR` to a path without spaces before starting the desktop app; some native dependencies use Autotools, which rejects build directories containing spaces.

## Find the right code

| Path             | Scope                                    |
| ---------------- | ---------------------------------------- |
| `apps/desktop`   | React desktop UI and Tauri application   |
| `apps/cli`       | CLI and MCP server                       |
| `plugins/*`      | Tauri plugin boundaries                  |
| `crates/*`       | Rust libraries                           |
| `packages/*`     | Shared TypeScript packages               |
| `crates/db-app`  | SQLite schema and migrations             |
| `skills/librelog` | Agent skill for the CLI and MCP server   |
| `docs`           | Mintlify product and reference documentation |

Sessions are the core data entity. Notes, transcripts, and summaries are all backed by sessions. ProseMirror documents use the TipTap JSON dialect.

## Validate your change

Format the files you changed before committing:

```bash
pnpm exec dprint fmt <changed-files>
pnpm exec dprint check <changed-files>
```

Run checks for every package you changed. Common commands include:

```bash
# Desktop TypeScript
pnpm -F @anlg/ui build
pnpm -F @anlg/desktop typecheck
pnpm -F @anlg/desktop test
pnpm exec oxlint --quiet apps/desktop/src/

# Changes spanning TypeScript packages
pnpm -r typecheck

# Rust
cargo check --locked -p <affected-package>
cargo test --locked -p <affected-package>
```

For documentation changes:

```bash
cd docs
npx mint validate
npx mint broken-links
```

Check the affected workflow under `.github/workflows/` for stricter package-specific commands. Pull requests that change Rust, Swift or Cargo files also run the macOS, Windows and Linux desktop checks in `desktop_ci.yaml`; to get them for a branch they skip, run that workflow from the Actions tab.

## Open a pull request

- Write the title as a specific action that states the intended outcome.
- Describe the problem and what the change does instead in a sentence or two. For UI changes, attach a screenshot or short recording.
- List the commands and manual checks you used to verify the change.

## Release a version

Releases are cut by merging a version bump into `main`:

1. Set `version` in `apps/desktop/package.json`, for example `0.1.0-beta.2`.
2. Add the release notes at `packages/changelog/content/desktop/<version>.md`.
3. Merge to `main`. `.github/workflows/release.yaml` builds the macOS apps, uploads the updater manifest and checksums, and publishes the release; installed apps pick it up on their next update check.

Betas are published as regular releases, not prereleases, because the updater reads `releases/latest`. If a build fails, rerun the workflow from the Actions tab with the same version.

When the macOS build never starts because GitHub has no runner for it ("The job was not acquired by Runner of type hosted"), release from an Apple silicon Mac instead. Check out the `main` commit that carries the version bump, cancel any queued release run, and run `scripts/release-local.sh build`, then `scripts/release-local.sh publish`. The build signs with the certificate in `~/.librelog-signing` (from `scripts/create-macos-signing-certificate.sh`) and the updater key in `~/.tauri/anarlog-fork-updater.key`; publishing uploads the same files the workflow would and publishes the draft it created.

## License

By submitting a contribution, you agree that it may be distributed under the repository's [MIT License](LICENSE). Only submit material you have the right to license this way, and record the upstream revision and license of any third-party code you reuse.
