use anlg_db_core::Db;
use db_migrate::{DbSchema, MigrateError, MigrationStep, migrate};

const CREATE_WIDGETS_SQL: &str = r#"
CREATE TABLE widgets (
    id INTEGER PRIMARY KEY NOT NULL,
    name TEXT NOT NULL DEFAULT ''
)
"#;

const CREATE_WIDGETS_WITH_STATUS_SQL: &str = r#"
CREATE TABLE widgets (
    id INTEGER PRIMARY KEY NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft'
)
"#;

const SEED_WIDGETS_SQL: &str = r#"
INSERT INTO widgets (id, name) VALUES (1, 'alpha')
"#;

const PLAIN_SCHEMA_STEPS: &[MigrationStep] = &[
    MigrationStep {
        id: "20260415010101_create_widgets",
        sql: CREATE_WIDGETS_SQL,
    },
    MigrationStep {
        id: "20260415010102_seed_widgets",
        sql: SEED_WIDGETS_SQL,
    },
];

const MODIFIED_PLAIN_SCHEMA_STEPS: &[MigrationStep] = &[MigrationStep {
    id: "20260415010101_create_widgets",
    sql: CREATE_WIDGETS_WITH_STATUS_SQL,
}];

const MISSING_VERSION_SCHEMA_STEPS: &[MigrationStep] = &[MigrationStep {
    id: "20260415010102_seed_widgets",
    sql: SEED_WIDGETS_SQL,
}];

const DUPLICATE_VERSION_SCHEMA_STEPS: &[MigrationStep] = &[
    MigrationStep {
        id: "20260415020101_create_widgets",
        sql: CREATE_WIDGETS_SQL,
    },
    MigrationStep {
        id: "20260415020101_seed_widgets",
        sql: SEED_WIDGETS_SQL,
    },
];

const INVALID_STEP_ID_SCHEMA_STEPS: &[MigrationStep] = &[MigrationStep {
    id: "invalid_step_id",
    sql: CREATE_WIDGETS_SQL,
}];

fn schema(steps: &'static [MigrationStep]) -> DbSchema {
    DbSchema { steps }
}

async fn open_plain_db() -> Db {
    Db::connect_memory_plain().await.unwrap()
}

async fn applied_versions(db: &Db) -> Vec<i64> {
    sqlx::query_scalar("SELECT version FROM _sqlx_migrations ORDER BY version")
        .fetch_all(db.pool())
        .await
        .unwrap()
}

async fn widget_names(db: &Db) -> Vec<String> {
    sqlx::query_scalar("SELECT name FROM widgets ORDER BY id")
        .fetch_all(db.pool())
        .await
        .unwrap()
}

#[tokio::test]
async fn plain_migrations_apply_and_remain_idempotent() {
    let db = open_plain_db().await;

    migrate(&db, schema(PLAIN_SCHEMA_STEPS)).await.unwrap();

    assert_eq!(
        applied_versions(&db).await,
        vec![20260415010101, 20260415010102]
    );
    assert_eq!(widget_names(&db).await, vec!["alpha".to_string()]);

    migrate(&db, schema(PLAIN_SCHEMA_STEPS)).await.unwrap();

    assert_eq!(
        applied_versions(&db).await,
        vec![20260415010101, 20260415010102]
    );
    assert_eq!(widget_names(&db).await, vec!["alpha".to_string()]);
}

#[tokio::test]
async fn changed_checksum_is_rejected() {
    let db = open_plain_db().await;

    migrate(&db, schema(&PLAIN_SCHEMA_STEPS[..1]))
        .await
        .unwrap();

    let err = migrate(&db, schema(MODIFIED_PLAIN_SCHEMA_STEPS))
        .await
        .unwrap_err();

    assert!(matches!(
        err,
        MigrateError::SqlxMigrate(sqlx::migrate::MigrateError::VersionMismatch(20260415010101))
    ));
}

#[tokio::test]
async fn missing_applied_version_is_rejected() {
    let db = open_plain_db().await;

    migrate(&db, schema(PLAIN_SCHEMA_STEPS)).await.unwrap();

    let err = migrate(&db, schema(MISSING_VERSION_SCHEMA_STEPS))
        .await
        .unwrap_err();

    assert!(matches!(
        err,
        MigrateError::SqlxMigrate(sqlx::migrate::MigrateError::VersionMissing(20260415010101))
    ));
}

#[tokio::test]
async fn invalid_manifest_metadata_is_rejected() {
    let db = open_plain_db().await;

    let invalid_id = migrate(&db, schema(INVALID_STEP_ID_SCHEMA_STEPS))
        .await
        .unwrap_err();
    assert!(matches!(
        invalid_id,
        MigrateError::InvalidStepId {
            step_id: "invalid_step_id"
        }
    ));

    let duplicate_version = migrate(&db, schema(DUPLICATE_VERSION_SCHEMA_STEPS))
        .await
        .unwrap_err();
    assert!(matches!(
        duplicate_version,
        MigrateError::DuplicateStepVersion {
            version: 20260415020101,
            ..
        }
    ));
}
