# Librelog Desktop

This file is auto-generated on app startup.

## Meeting data

Use Librelog's typed, read-only interfaces for meeting data. Do not use `find`,
`grep`, `rg`, filesystem crawling, or direct SQLite queries to find or read
meetings.

Prefer the Librelog MCP tools when they are available:

- `list_meetings` to resolve a meeting ID
- `list_folders` to scope `list_meetings` to a folder with `folder_path`
- `get_meeting` for notes, summaries, participants, and action items
- `get_meeting_transcript` for bounded transcript pages
- `get_recurring_meeting_history` for meetings in the same recurring series

If MCP is unavailable, use the Librelog CLI with `--json`:

```sh
librelog --json meetings list --query "planning"
librelog --json meetings folders
librelog --json meetings list --folder "Projects/Launch"
librelog --json meetings get MEETING_ID
librelog --json meetings transcript MEETING_ID --limit 200 --offset 0
librelog --json meetings history MEETING_ID
```

The CLI discovers Librelog's database from the platform application-data
directory. Use `--db-path ABSOLUTE_APP_DB` only when the user explicitly
provides a non-default database path; do not crawl the filesystem to find one.
Never guess a meeting ID. Keep transcript requests bounded and continue from
`pagination.next_offset` only when more context is needed.

Documentation: https://github.com/Arturgrr/librelog/tree/main/docs

Agent skill: https://github.com/Arturgrr/librelog/blob/main/skills/librelog/SKILL.md
