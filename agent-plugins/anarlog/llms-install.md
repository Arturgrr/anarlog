# Set up Anarlog agent access

1. On the user's computer, select the executable available on `PATH`: `anarlog-cli` on Flatpak, otherwise `anarlog`. Use that selected executable for every CLI command below, starting with `--json doctor`. If neither is installed, explain the installation steps in the plugin README; do not install software without authorization.
2. If the agent supports MCP, configure a stdio server named `anarlog` with the selected executable as its command and arguments `["mcp"]`. The server needs the user's local database, so do not configure it in a remote environment.
3. Confirm the MCP server lists `list_meetings`, `get_meeting`, `get_meeting_transcript`, `get_recurring_meeting_history`, and `export_meeting`. An empty search is not a missing database; report database errors to the user.
4. Never query or modify Anarlog's SQLite database directly.

Staging a note or summary edit uses the CLI or MCP proposal tools; a human applies or declines it in the desktop app. Anarlog has no account, hosted service, or cloud connection.
