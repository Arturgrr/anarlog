# Instruction

- Keep only user-facing changes. No internal changes or infra updates.
- Maintain desktop notes in `desktop/<version>.md`, where `<version>` matches `apps/desktop/package.json` exactly, beta suffix included (`0.1.0-beta.2.md`). The app shows that file as "What's new", and the release workflow refuses to publish a version without one and copies it into the GitHub release.
- Each changelog must include `date` and `summary` frontmatter. Keep `summary` to one concise, plain-text, user-facing sentence with no markdown or custom tags.

```md
---
date: "YYYY-MM-DD"
summary: "One concise, user-facing sentence for the changelog index preview."
---
```

# Custom Tags

The desktop changelog renderer (Streamdown-based) supports custom HTML tags beyond standard markdown.

## `<banner>`

Use for announcements, important notices, or highlights.

Attributes:

- `title` (optional): Bold heading text at the top of the banner.
- `variant` (optional): `"warning"` for amber/yellow style, `"info"` for blue style. Defaults to amber/info style.

```mdx
<banner title="Welcome to the beta">
Expect rough edges, and report anything that breaks from Help → Report Bug.
</banner>

<banner title="Breaking Change" variant="warning">
The old plugin format is no longer supported. Please update your plugins.
</banner>
```
