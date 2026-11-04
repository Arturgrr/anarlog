# Anarlog documentation instructions

## Scope

- This is the Mintlify project for Anarlog. There is no hosted documentation site yet; the pages live in this repository.
- Write for Anarlog users, developers, and agents using the CLI or local MCP server.
- Configuration lives in `docs.json`; content pages are MDX.
- `skill.md` is generated from the packaged skill in `../skills/anarlog/`. Do not edit it by hand.

## Product boundaries

- Anarlog is local-first and fully open source. There is no account, sign-in, subscription, cloud sync, sharing, telemetry, or hosted AI.
- Transcription and Intelligence run on local models or on providers configured with the user's own API keys.
- Do not document hosted services, paid plans, or features that require an Anarlog server.

## Sources of truth

- Treat `apps/cli/src/cli.rs` as the CLI command contract.
- Treat `apps/cli/src/mcp.rs` as the MCP tool and resource contract.
- Treat current release automation as the source of truth for installation channels.
- Do not infer product behavior from the raw SQLite schema.

## Writing

- Use active voice and second person.
- Keep headings and sentences concise.
- Put the result before implementation detail.
- Use `Anarlog` for the product and `anarlog` for the executable.
- Use root-relative links between Mintlify pages.

## Accuracy boundaries

- Document only commands, options, tools, resources, and output behavior present in the source.
- Mark planned features and distribution channels as forthcoming.
- Never describe Homebrew, standalone release binaries, or package-manager installation as available until release automation publishes them.
- Document desktop-bundled CLI installation only for builds that include the CLI sidecar and installer UI.
- Never tell users or agents to read, migrate, or modify the SQLite database directly.
- Keep transcript examples bounded. CLI and MCP transcript pages default to 200 words and cap at 500 words.

## Verification

- Check `docs.json` after adding or moving a page.
- Run `pnpm exec dprint fmt 'docs/**/*' 'skills/**/*'` from the repository root.
- Run `pnpm exec dprint check 'docs/**/*' 'skills/**/*'` before submitting.
- Run `mint validate` and `mint broken-links --check-anchors --check-redirects` from `docs/`.
