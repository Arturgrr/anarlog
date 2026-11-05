# Anarlog documentation

This Mintlify project holds the Anarlog user, CLI, and agent documentation. There is no hosted documentation site yet; read the pages in this directory or preview them locally.

## Local preview

Install the Mintlify CLI, then run it from this directory:

```bash
npm install --global mint
cd docs
mint dev
```

Update `docs.json` whenever a page is added, moved, or removed. Keep CLI and MCP reference content aligned with `apps/cli/src/cli.rs` and `apps/cli/src/mcp.rs`. `skill.md` is generated from `../skills/anarlog/`; keep them aligned.

Before submitting changes, run:

```bash
mint validate
mint broken-links --check-anchors --check-redirects
```
