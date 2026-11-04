# Instruction

- Keep only user-facing changes. No internal changes or infra updates.
- Maintain desktop notes in `desktop/<version>.md`. Root `<version>.md` files are historical copies kept for older desktop builds; do not add new ones.
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
<banner title="Hyprnote is now Char!">
We've renamed the app. All your data is safe and nothing changes on your end.
</banner>

<banner title="Breaking Change" variant="warning">
The old plugin format is no longer supported. Please update your plugins.
</banner>
```
