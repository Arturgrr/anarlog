# `db-app`

## Use This Crate For

- The app-owned SQLite schema shared by desktop and the CLI.
- Migration manifest (`APP_MIGRATION_STEPS`) and schema preparation (`prepare_schema`).
- Thin SQL row/upsert types and CRUD helpers for app tables.

## Put Changes Elsewhere When

- Pool opening, pragmas, or SQLite hooks belong in `db-core`.
- Migration execution semantics belong in `db-migrate`.
- One-shot transport or live-query transport belongs in `db-execute` or `plugins/db`.
- Reactive invalidation logic belongs in `db-reactive`.

## Hard Rules

- Treat migration ids and shipped SQL as append-only. Add a new step instead of mutating an existing one.
- Nightly and stable desktop builds open the same database. Keep new steps downgrade-safe so stable can still open a database that Nightly migrated. A `-- breaking` step raises the compat floor and locks stable out until stable includes it; add one only in the candidate that becomes the next stable release.
- Databases synced by older builds still carry sqlite-sync triggers and metadata tables. `detach_legacy_cloudsync` removes them before migrations run; keep it idempotent and keep `tests/fixtures/cloudsync_initialized.db` opening without the extension.
- The `cloudsync_workspace_binding` row in `app_settings` is the device workspace. Migration SQL, triggers, and insert helpers read it by that name; do not delete or rename it.
- Tables, triggers, and dirty-row queues left by the removed sync (`e2ee_*`, `cloudsync_*`, `attachment_transfer_jobs`) stay in the schema because shipped migrations created them. Do not drop them outside a migration.
- Every runtime that opens the app database uses `anlg_db_app::schema()`. Schema drift must be fixed here, not in transport layers.
- JSON-shaped fields stay as opaque `TEXT`. Parsing and legacy-shape normalization belong in adapters/importers, not this crate.
- `events.calendar_id` is intentionally not a foreign key today. Adding FK or cascade behavior changes import and delete semantics; audit both first.
- Keep helper behavior stable: upserts preserve `created_at`, bump `updated_at`, and list queries stay deterministic unless you intentionally want downstream churn.
- `insert_*_if_missing` is import-only. Normal write paths should use the upsert helpers.
