# Setup

Anarlog runs entirely on the user's computer. Agents use the local CLI or the local MCP server; neither needs an account or network access.

## Local CLI

Use the CLI with `--json`. Run `anarlog --json doctor` to check readiness, then `anarlog --json meetings list`.

Open **Anarlog → Settings → Developers** and select **Install**. Direct-download builds install:

- macOS and Linux (DEB / AppImage): `~/.local/bin/anarlog`
- Windows: `%LOCALAPPDATA%\Anarlog\bin\anarlog.exe`

The Mac App Store build does not bundle CLI installation. Build from source instead.

To build from source:

```bash
git clone https://github.com/Arturgrr/anarlog.git
cd anarlog
cargo install --locked --path apps/cli
anarlog --version
```

Run the Anarlog desktop app once so its local database exists. The CLI works while the app is closed after that.

On Flatpak, the host command is `anarlog-cli`. On DEB, AppImage, macOS, Windows, and Settings-installed builds, the command is `anarlog`.

Use `--db-path FILE` or `ANARLOG_DB_PATH` only when the database is outside Anarlog's default application-data location.

## Local MCP

For an agent with MCP support, run the stdio server:

```bash
anarlog mcp
```

A generic client configuration is:

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

The Anarlog agent plugin configures this server for you. Restart the client after changing its MCP configuration.
