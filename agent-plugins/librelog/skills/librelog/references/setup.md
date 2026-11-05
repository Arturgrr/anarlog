# Setup

Librelog runs entirely on the user's computer. Agents use the local CLI or the local MCP server; neither needs an account or network access.

## Local CLI

Use the CLI with `--json`. Run `librelog --json doctor` to check readiness, then `librelog --json meetings list`.

Open **Librelog → Settings → Developers** and select **Install**. Direct-download builds install:

- macOS and Linux (DEB / AppImage): `~/.local/bin/librelog`
- Windows: `%LOCALAPPDATA%\Librelog\bin\librelog.exe`

The Mac App Store build does not bundle CLI installation. Build from source instead.

To build from source:

```bash
git clone https://github.com/Arturgrr/librelog.git
cd librelog
cargo install --locked --path apps/cli
librelog --version
```

Run the Librelog desktop app once so its local database exists. The CLI works while the app is closed after that.

On Flatpak, the host command is `librelog-cli`. On DEB, AppImage, macOS, Windows, and Settings-installed builds, the command is `librelog`.

Use `--db-path FILE` or `LIBRELOG_DB_PATH` only when the database is outside Librelog's default application-data location.

## Local MCP

For an agent with MCP support, run the stdio server:

```bash
librelog mcp
```

A generic client configuration is:

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

The Librelog agent plugin configures this server for you. Restart the client after changing its MCP configuration.
