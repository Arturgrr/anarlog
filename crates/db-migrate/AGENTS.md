# `db-migrate`

## Role

App-database migration execution. Narrow port of `sqlx` migration behavior with one intentional divergence: a schema-compat floor raised by `-- breaking` steps so older builds refuse databases they cannot read.

## Owns

- Migration orchestration and `_sqlx_migrations` bookkeeping.
- `MigrationStep` → `sqlx::migrate::Migration` translation.
- Validation of step ids and duplicate versions.
- The `_anlg_schema_compat` floor for breaking steps.

## Does Not Own

- Pool creation or database opening.
- App table definitions, row types, query APIs, migration SQL contents.

## Invariants

- Preserves `sqlx` semantics: ordered apply, checksum validation, dirty-version detection, idempotent re-run.
- Newer additive migrations are tolerated; a database whose compat floor is above this build's newest step is refused.
- The floor is raised before a breaking step's DDL runs.
