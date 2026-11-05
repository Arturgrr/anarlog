# Librelog agent plugin

Query your Librelog meetings from an AI agent. The plugin bundles the Librelog skill and starts the local MCP server (`librelog mcp`) over stdio. It reads notes, summaries, participants, action items, bounded transcript excerpts, recurring history, and complete exports when explicitly needed. Everything stays on your computer; there is no account or hosted service.

## Requirements

1. Install the Librelog desktop app from [GitHub Releases](https://github.com/Arturgrr/librelog/releases) and open it once to create its database.
2. Install the CLI from **Settings → Developers → Install**, or build it from source:

   ```bash
   git clone https://github.com/Arturgrr/librelog.git
   cd librelog
   cargo install --locked --path apps/cli
   ```

3. Make sure `librelog` is on your `PATH` (`librelog-cli` on Flatpak), then run `librelog --json doctor`.

The app can be closed after its database exists.

## Install from this repository

### Claude Code

Load the plugin, including the skill, from a clone of this repository:

```bash
claude --plugin-dir ./agent-plugins/librelog
```

Or add only the MCP server:

```bash
claude mcp add librelog -- librelog mcp
```

### Codex and Cursor

Load `agent-plugins/librelog` as a local plugin. The plugin manifests point at the bundled skill and the stdio MCP server.

## Configure MCP directly

Clients that do not install plugins can add the local server:

```json
{
  "mcpServers": {
    "librelog": {
      "command": "librelog",
      "args": ["mcp"]
    }
  }
}
```

On Flatpak, use `librelog-cli` as the command. See [MCP for agents](https://github.com/Arturgrr/librelog/blob/main/docs/agents/mcp.mdx).

## Data access

The CLI and MCP server read the desktop app's local database through Librelog's compatibility layer. Proposal tools stage edits that a human applies or declines in the desktop app. Recording imports send audio only to the transcription and summary providers you configured. See [Data and privacy](https://github.com/Arturgrr/librelog/blob/main/docs/data-and-privacy.mdx).
