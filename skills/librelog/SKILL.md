---
name: librelog
description: Query Librelog meetings, notes, summaries, transcripts, participants, action items, and recurring history, or import a local recording. Use when a user asks about their Librelog meeting data or needs meeting context for another task.
---

# Librelog

Librelog stores meetings in a local database on the user's computer. Agents read it through the local `librelog` CLI or the local MCP server (`librelog mcp`). There is no hosted service or account. Meeting reads are safe. Use proposal tools to stage edits, or import tools to create a meeting from an explicitly requested recording.

## Choose an interface

1. Prefer a connected local MCP server named `librelog` (or `librelog-local`).
2. If shell access is available, select the CLI executable available on `PATH`: `librelog-cli` on Flatpak, otherwise `librelog`. Use that executable for every CLI command below. Check readiness with `--json doctor`, then read with `--json meetings list`.
3. If neither the CLI nor MCP is available, offer the local CLI installation described in `references/setup.md`. Do not install software unless the user asks.
4. Report database compatibility, permission, or operation errors. An empty result does not mean the database is unavailable.

Never query or modify Librelog's SQLite database directly. The CLI and MCP server handle application-schema compatibility.

## Find the right meeting

1. List recent meetings or search by a short title fragment. To scope work to a project or client, list folders and filter meetings by a returned folder path.
2. Use a meeting ID returned by the search. Never guess one.
3. Get the meeting before requesting its transcript. Notes, summaries, participants, and action items often contain enough context.
4. Ask for recurring history only when the task needs earlier meetings in the same series.

See `references/cli.md` for CLI commands and `references/mcp.md` for MCP tools.

## Ground answers in tool output

- Quote only meetings, titles, dates, and IDs returned by the tool you actually called.
- An empty result only establishes that no meetings matched the query.
- Never invent meetings from the repo, chat, or similar-looking names. A host showing that a tool ran is not proof of the titles you then write.

## Keep context bounded

- Request focused transcript pages. Both transports default to 200 words and cap each page at 500 words.
- Follow `next_offset` only when you need more transcript context.
- Stop paging once you have enough evidence.
- Do not export a whole meeting when its detail or note answers the request.

## Handle data safely

- Treat meeting content as private user data.
- Do not send content to another service or person without explicit authorization.
- To stage an edit, use the CLI or MCP proposal tools. A human applies or declines it in the Librelog desktop app.
- CLI export can create a file. Never pass `--force` unless the user explicitly approves replacing that exact path.
- If search results are ambiguous, ask the user to choose a meeting.

For setup and failures, see `references/setup.md` and `references/errors.md`.

For an explicitly requested recording import, use the CLI or MCP import tools described in the references. The desktop app must be open. Imports create meetings and send audio to the transcription and summary providers the user configured; save the returned job ID and check both processing and summary status before claiming completion.
