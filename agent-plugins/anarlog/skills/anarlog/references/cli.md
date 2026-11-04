# CLI commands

Use `--json` for agent-readable output.

Linux Flatpak installs this command as `anarlog-cli`; use that name instead of `anarlog` in the examples when that is the command on PATH.

```bash
anarlog --json doctor
anarlog --json meetings list --query "planning" --limit 20 --offset 0
anarlog --json meetings folders --query "clients"
anarlog --json meetings list --folder "Clients/ACME" --limit 20
anarlog --json meetings get MEETING_ID
anarlog --json meetings note MEETING_ID --kind note
anarlog --json meetings note MEETING_ID --kind summary
anarlog --json meetings history MEETING_ID --limit 20 --offset 0
anarlog --json proposals list --meeting MEETING_ID
anarlog --json proposals create --meeting MEETING_ID --kind summary --content "Replacement markdown"
anarlog --json proposals show PROPOSAL_ID
anarlog --json proposals decline PROPOSAL_ID
```

`proposals create` stages a pending edit. Do not claim the meeting changed. A human applies or declines it in the Anarlog desktop app.

Meeting commands read the local database (`--source local`, the default). Meetings include `folder_path`, or `null` outside a folder.

`doctor` exits with status 1 when its response contains `ready: false`.

Read transcripts in bounded word pages:

```bash
anarlog --json meetings transcript MEETING_ID --limit 200 --offset 0
```

JSON success responses contain `schema_version`, `command`, `data`, and optional `pagination`. Continue from `pagination.next_offset` only when more context is necessary.

Export is intended for an explicit user request to save or transfer a complete meeting:

```bash
anarlog meetings export MEETING_ID --format markdown --output meeting.md
anarlog meetings export MEETING_ID --format json --output meeting.json
```

Export refuses to replace an existing file. Pass `--force` only after the user explicitly approves overwriting that exact path.

Markdown exports label transcript paragraphs with speaker names when word-level speaker information is available. Exports without that information retain flat text. JSON exports can include optional `speakers` and `speaker_context` fields.

Global database overrides:

```bash
anarlog --db-path /path/to/app.db --json meetings list
anarlog --base /path/to/anarlog-data --json meetings list
```

### Managed local capture

`anarlog meetings capabilities` reports managed-settings, calendar-identity, recording-attachment, capture-completion, hold-inventory (including parentless history and files without database rows), pilot-usage, and conditional-delete support without opening a database.

`anarlog meetings delete` permanently removes a completed local meeting, its document history, transcripts, recordings, and derived search index. It requires `--source local`, `--if-export-sha256` (the SHA-256 of the complete JSON export, either as printed to stdout with its final newline or as saved with `--output`), and `--require-transcription-complete`. Close the desktop app first. A changed export or an unfinished transcript prevents deletion. An interrupted file removal can be resumed with the same meeting ID and hash.

A version 1 `managed_settings.json` beside the active `app.db` contains a `settings` object. Only supported capture settings are accepted, and secrets are rejected. Managed rows override user changes; malformed policy prevents database startup. `intelligence_disabled: true` disables all model connections, including local models. Transcription credentials remain in the OS credential store.

`meetings initialize-managed` (`anarlog --json meetings --source local initialize-managed`) creates or migrates the local database before first desktop launch. An existing `managed_settings.json` that disables intelligence is required; the desktop must be closed. No recording or permission prompt is started.

`meetings hold-list` (`anarlog --json meetings --source local hold-list`) enumerates local meeting IDs retained by sessions, child/history rows, capture-recovery markers and encrypted session revisions, including soft-deleted or missing parent rows and identities retained only by recording or legacy meeting files, in ID order. Filesystem traversal stays within the recorder sessions directory, refuses links and fails rather than truncating an oversized or unreadable inventory. Use `--limit 1..200` and `--after ID` for keyset pagination; an empty `data.ids` array ends the inventory. Managed preservation agents can use `--database-only` to page database-owned identities while separately walking and preserving recording files with durable checkpoints. This mode skips filesystem discovery; its pages alone do not establish a complete hold inventory.

`meetings hold-export` (`anarlog --json meetings --source local hold-export MEETING_ID`) streams meeting-owned database cells and retained revisions from one read transaction as NDJSON. Each bounded cell frame carries the table, row key, column, SQLite storage type, byte offset, total length, and base64 bytes. Integer and REAL cells use round-trip text; TEXT and BLOB bytes remain exact. The header identifies the meeting and schema and lists `recording_locations` relative to the recorder sessions directory; sequences and the final SHA-256 cover every preceding line including its newline. An absent end frame means an incomplete snapshot. The archive includes tombstoned documents, live transcript deltas, per-session raw capture-recovery memos and related encrypted revisions. A parent session row is not required when owned records or meeting files remain. A files-only archive has no database cell frames; its header still identifies every discovered location, including moved copies. It excludes global settings, provider credentials and unrelated meetings. Recording files are preserved separately by the managed agent. With `--database-only`, the archive skips filesystem discovery and sets `recording_files_separate: true` with an empty `recording_locations` array. The agent must complete its separate file inventory and verify each catalogued attachment before treating preservation as complete. This local preservation archive is separate from normal meeting export and must not enter knowledge intake.

`meetings pilot-usage` requires `--json` and `--source local`. Supply `--from-ms` and `--until-ms` as Unix milliseconds for a half-open UTC window of at most 366 days. The command reads capture intervals from the native stop registry's locally persisted measurement ledger. It returns clocks, requested-live and live-at-stop flags, and coverage counts without meeting identifiers, text, titles, invitees, or provider credentials. The ledger is recorded for managed capture with intelligence disabled; it survives deletion of meeting content. Pauses are separate intervals. Older recordings, interrupted persistence, and pending sessions can leave coverage incomplete; inspect `unmeasured_stops`, `invalid_metadata_records`, `pending_sessions`, and `legacy_sessions_without_measurement`. Empty results do not prove no calls occurred. Capture durations and requested-live overlap measure recorder use, not provider billing or successful Teams capture. No report is uploaded automatically.

## Import local audio

Use `anarlog --json meetings --source local import FILE --request-key KEY` when the user asks to import a recording. The updated desktop app must be open on the same database; configured providers may receive audio and charge for processing. Optional `--title`, `--folder` (existing folder), and `--wait --timeout 3600` are supported. Save `meeting_id` and `job_id`. Poll `anarlog --json meetings import-status JOB_ID`, or inspect `processing_status` and `recording_import` in local `meetings get`. Timeout exit 2 does not cancel work. A completed import may report a skipped summary. Reuse the request key for retries, never silently create a second job after failure. SRT/VTT files are not supported.

## Legacy account commands

`auth login`, `auth status`, and `auth logout` remain in the binary for compatibility with upstream builds. This fork has no hosted service or account, so agents should not use them.
