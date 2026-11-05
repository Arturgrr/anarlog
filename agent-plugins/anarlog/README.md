# Anarlog agent plugin

Query your Anarlog meetings from an AI agent. The plugin bundles the Anarlog skill and starts the local MCP server (`anarlog mcp`) over stdio. It reads notes, summaries, participants, action items, bounded transcript excerpts, recurring history, and complete exports when explicitly needed. Everything stays on your computer; there is no account or hosted service.

## Requirements

1. Install the Anarlog desktop app from [GitHub Releases](https://github.com/Arturgrr/anarlog/releases) and open it once to create its database.
2. Install the CLI from **Settings → Developers → Install**, or build it from source:

   ```bash
   git clone https://github.com/Arturgrr/anarlog.git
   cd anarlog
   cargo install --locked --path apps/cli
   ```

3. Make sure `anarlog` is on your `PATH` (`anarlog-cli` on Flatpak), then run `anarlog --json doctor`.

The app can be closed after its database exists.

## Install from this repository

### Claude Code

Load the plugin, including the skill, from a clone of this repository:

```bash
claude --plugin-dir ./agent-plugins/anarlog
```

Or add only the MCP server:

```bash
claude mcp add anarlog -- anarlog mcp
```

### Codex and Cursor

Load `agent-plugins/anarlog` as a local plugin. The plugin manifests point at the bundled skill and the stdio MCP server.

## Configure MCP directly

Clients that do not install plugins can add the local server:

```json
{
  "mcpServers": {
    "anarlog": {
      "command": "anarlog",
      "args": ["mcp"]
    }
  }
}
```

On Flatpak, use `anarlog-cli` as the command. See [MCP for agents](https://github.com/Arturgrr/anarlog/blob/main/docs/agents/mcp.mdx).

## Data access

The CLI and MCP server read the desktop app's local database through Anarlog's compatibility layer. Proposal tools stage edits that a human applies or declines in the desktop app. Recording imports send audio only to the transcription and summary providers you configured. See [Data and privacy](https://github.com/Arturgrr/anarlog/blob/main/docs/data-and-privacy.mdx).
