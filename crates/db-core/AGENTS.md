# `db-core`

## Role

Database substrate layer. Owns `Db`, SQLite open options, pool lifecycle, and per-connection SQLite wiring.

## Owns

- Opening local and in-memory SQLite databases.
- SQLite pragmas and connection policy.
- Wiring `db-change::ChangeNotifier` into pool creation via `SqlitePoolOptions::after_connect`.

## Does Not Own

- App-specific database paths or bootstrap decisions.
- Schema definitions, migrations, migration SQL.
- Hook logic itself (owned by `db-change`).
- Dependency analysis, subscription registries, rerun policy, sink delivery.
- Tauri commands, JS bindings, React hooks.

## Invariants

- Per-connection SQLite setup happens in `SqlitePoolOptions::after_connect`.
- Table-change notifications are best-effort signals for pooled writes only.
- Schema-agnostic; callers supply migration callbacks.
