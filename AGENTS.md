# Overview

Anarlog is a pnpm and Rust workspace. Read the nearest `AGENTS.md` before changing a component.

- `apps/desktop/`: Tauri 2 with React, TypeScript, Vite, and Tailwind. Zustand owns UI state; TanStack Query/Form own queries, mutations, and forms.
- `apps/api/`: Rust/Axum API.
- `apps/cli/`: Rust CLI/TUI and MCP entry point (`anarlog-cli` package, `anarlog` binary).
- `crates/db-app/`: canonical SQLite schema and migrations shared by desktop and the CLI. `db-core` owns runtime initialization, `db-migrate` owns migration execution, and `plugins/db/` exposes the desktop transport. React consumes these through `packages/db-runtime`, `packages/db-react`, and `packages/db-tauri`; `packages/db` is the Drizzle adapter.
- `supabase/`: hosted Postgres migrations and database tests, separate from local SQLite migrations.

Sessions are the core entity: all notes are backed by sessions. ProseMirror powers the editor (`packages/editor`, via `@handlewithcare/react-prosemirror`); documents use TipTap-dialect ProseMirror JSON, with converters/validation in `crates/tiptap`.

## Commands

- Install: `pnpm install --frozen-lockfile`. Match CI's Node 22, `package.json#packageManager`, and `rust-toolchain.toml`; keep lockfiles in sync with intentional dependency changes.
- Format: `pnpm exec dprint fmt --allow-no-files <changed-files>`; check: `pnpm exec dprint check --allow-no-files <changed-files>`. Whole-repository check: `pnpm fmt:check`.
- Typecheck (TS): `pnpm -F <package-name> typecheck`; use `pnpm -r typecheck` for changes spanning packages. Use actual names from package manifests, such as `@anlg/desktop`.
- Typecheck (Rust): `cargo check --locked -p <package>`; match the relevant workflow's features and target. A root `cargo check` does not cover every platform.
- Build shared UI before desktop checks: `pnpm -F @anlg/ui build`.
- Desktop dev: `pnpm dev:desktop`.
- Combined desktop/API/local Supabase: `pnpm dev`; backend only: `pnpm dev:api`. Requires Docker, Task, and API configuration. Process Compose 1.122.0+ owns process lifecycle and logs; Turbo owns the shared UI build. See `CONTRIBUTING.md` for control ports and headless use.
- Dev docs: https://docs.anarlog.so

## Pre-commit verification

Treat `.github/workflows/` and their composite actions as the source of truth for commands, setup, features, targets, and exclusions. Re-read them when changing this guide or CI. Run locally reproducible checks before committing; include affected consumers of shared packages even when workflow path filters miss them. A skipped workflow/job is not passing coverage.

### Common checks

- Format the changed files, then check the same files. `fmt.yaml` checks added/copied/modified/renamed files against the PR base and falls back to `pnpm fmt:check` when no base is available. Use the complete branch diff for final verification, not only the last commit. Respect `dprint.json` associations/exclusions: `--allow-no-files` permits excluded paths but does not validate them. Avoid formatting unrelated work in a shared workspace.
- `lint.yaml`: `pnpm exec oxlint --quiet --format=github apps/desktop/src/`. The root `pnpm lint` also runs type-aware Oxlint and ESLint; it is broader than this CI job. Run configured ESLint checks for touched desktop query code with `pnpm exec eslint <changed-files>`.
- `ci.yaml`: run the complete `node --test` command listed there. These run on every PR, including documentation-only changes.
- `zizmor.yaml` runs on every PR. Reproduce `uvx zizmor --format sarif .` (save output outside the repository) with read-only GitHub access; report unavailable authenticated checks. Inspect the SARIF findings: a successful scan/upload does not mean zero findings. Fix findings introduced by workflow/action changes and report existing findings separately.
- For TypeScript changes, run affected packages' typechecks and existing test scripts. For Rust changes, run affected crate checks/tests with the workflow's flags; retain `--locked`, feature selections, test filters, and Clippy's `-D warnings`. Add regression coverage for changed behavior, especially persistence, auth, billing, and recording lifecycles.
- Decide what to test, delete, or leave untested with `.agents/skills/testing/SKILL.md`: one regression test per fix, no tests for CSS, copy, mock call counts, private state, or file layout. Structural and import-boundary rules belong in lint rules, not tests.

### Checks by component

This map is a starting point; execute the relevant workflow's full locally reproducible job, including setup and generated-file checks.

| Changed component                                         | Validation and source                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop frontend and shared UI/editor packages            | Build `@anlg/ui`, then `pnpm -F @anlg/desktop typecheck`, `pnpm -F @anlg/desktop test`, lint, and i18n validation. Run changed packages' own scripts too. See `desktop_ci.yaml`.                                                                                                                                                                                                                                                                                 |
| Desktop Rust, plugins, CloudSync                          | See `desktop_ci.yaml`: macOS checks both `direct-distribution` and `app-store` features and runs desktop/workspace tests; Linux/Windows use their own targets and test selections. Preserve the workspace-test exclusions. CloudSync gates include `cargo test --locked -p cloudsync` and `cargo test --locked -p db-core 'cloudsync::' -- --test-threads=1`. Swift window changes also require `swift build --package-path plugins/windows/swift-lib` on macOS. |
| API and related crates                                    | See `api_ci.yaml`: `cargo check -p api`; tests for `api-cloud`, `api-auth`, `mcp`, `supabase-auth --features server`, `api-sync`, `transcribe-proxy --lib`, the API drain test, and the deployment/E2EE Python tests. Regenerate and verify OpenAPI as described below.                                                                                                                                                                                          |
| CLI, agent access, local SQLite schema/migrations, TipTap | See `cli_ci.yaml`: locked tests for `agent-access`, `anarlog-cli`, `db-app`, `db-core`, `db-migrate`, and `tiptap`; Clippy with `--all-targets --no-deps -- -D warnings`; release CLI build and isolated smoke tests. Preserve the Linux/Windows smoke checks and skill/docs validation.                                                                                                                                                                         |
| Hosted database                                           | In an isolated local Supabase stack with Docker, run `supabase db start`, then `supabase test db` as in `db_ci.yaml`. Include migration and RLS regression tests; never point these checks at a hosted database.                                                                                                                                                                                                                                                 |

### Generated files and data compatibility

- Desktop i18n has its own `desktop_ci.yaml` job. When translated copy, extraction, or catalogs change, run `pnpm -F @anlg/desktop exec lingui extract --clean --workers 1` and `pnpm -F @anlg/desktop exec lingui compile --strict --workers 1`; include the resulting `apps/desktop/src/i18n/locales` changes and rerun until stable. `pnpm -F @anlg/desktop i18n:check` includes a diff against HEAD, so an intentional uncommitted catalog change will fail that final diff. Run it when catalogs are committed/clean; do not discard intended translations to make it pass.
- API contract changes: run `cargo test -p api gen_openapi_json`, then `pnpm -F @anlg/api-client openapi` when the contract changes. Commit `apps/api/openapi.gen.json` and corresponding generated client changes. CI checks the OpenAPI file against HEAD; verify generation is stable before committing and the diff is clean afterward.
- Regenerate native bindings and permissions using their owning Rust build/generator; do not hand-edit generated output. The macOS desktop job checks `plugins/db/js/bindings.gen.ts`, `plugins/db/permissions/autogenerated`, and `plugins/db/permissions/schemas/schema.json` for drift.
- Keep shipped SQLite migration IDs/SQL append-only, and update the Drizzle adapter when schema changes affect it. Follow `crates/db-app/AGENTS.md` for explicit CloudSync migration scope and table policy. Test upgrades from supported older schemas as well as fresh initialization.

Fix failures caused by the change before committing. If an existing unrelated failure or unavailable platform, secrets, hardware, or infrastructure prevents a check, record the exact command, result, and reason in the handoff. Keep focused passes separate from full-suite failures; do not report full validation or release readiness with unresolved gates.

## Guidelines

- JavaScript/TypeScript formatting runs through `oxfmt` via dprint's exec plugin.
- Use `useForm` (tanstack-form) and `useQuery`/`useMutation` (tanstack-query) for form/mutation state. Avoid manual state management (e.g. `setError`).
- Keep schema creation, migrations, and DB initialization on the Rust side. TypeScript consumes the shared transport contracts; the Drizzle adapter uses `executeProxy` and must not parse SQL or remap named rows into positional rows.
- New SQLite migrations must be downgrade-safe (older builds tolerate newer schemas): additive only, new columns nullable or with a DEFAULT. If a migration can't be downgrade-safe, add a `-- breaking` line to the leading comment block of its `.sql` file so older builds refuse the database with an update prompt. Nightly and stable desktop builds share one database, so a breaking migration published in Nightly locks stable out until stable ships it.
- Branch naming: `fix/`, `chore/`, `refactor/` prefixes.
- PR titles and commit messages: the title summarizes intent, not the diff or a ticket number. The description is a short summary of what changed, not a generated commit log or file-by-file recap. See `.github/PULL_REQUEST_TEMPLATE.md` for the Intent/How tested structure.

## Code Style

- Avoid creating types/interfaces unless shared. Inline function props.
- Do not write comments unless code is non-obvious. Comments should explain "why", not "what".
- Use `cn` from `@anlg/utils` for conditional classNames. Always pass an array, split by logical grouping.
- Use `motion/react` instead of `framer-motion`.
- Prefer DOM order for local overlap and portals for cross-tree floating UI. Use `z-index` only inside a bounded stacking context with explicit sibling ordering; do not add arbitrary global or escalating values.

## CLI TUI Command Architecture

Choose the lightest command structure that fits the workflow.

Use the full reducer/effect/runtime split only when the command has async orchestration, a multi-step workflow, or substantial state transitions that benefit from reducer-style tests.

```
commands/<name>/
  mod.rs        -- Screen impl, Args, run()          [glue]
  app.rs        -- App or screen-local state          [optional]
  action.rs     -- Action enum                        [optional]
  effect.rs     -- Effect enum                        [optional]
  runtime.rs    -- Runtime, RuntimeEvent              [async I/O]
  ui.rs         -- draw(frame, app)                   [rendering]
```

Naming rules:

- Types drop the command prefix: `App`, `Action`, `Effect`, `Runtime`, `RuntimeEvent`
- `app.rs` → `app/mod.rs` with private submodules when state is complex
- `ui.rs` → `ui/mod.rs` with sub-files when rendering is complex
- `action.rs`/`effect.rs` are siblings of `mod.rs` when they exist; do not create them by default for simple list/detail screens
- `app.rs` contains no rendering logic, no API calls, no async code when using the reducer pattern
- Prefer `screen.rs` plus a small local state struct for simple browse/select flows
- Do not add parent-level action/effect translation layers that proxy child workflows through another command's reducer

## Misc

- Do not create summary docs or example code files unless requested.
