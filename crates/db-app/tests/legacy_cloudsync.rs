use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use anlg_db_core::{Db, DbOpenOptions, DbStorage};

// Every table sqlite-sync 1.2.0 tracked in tests/fixtures/cloudsync_initialized.db.
const FORMERLY_SYNCED_TABLES: &[&str] = &[
    "action_items",
    "calendars",
    "chat_groups",
    "chat_messages",
    "daily_notes",
    "e2ee_records",
    "entity_mentions",
    "events",
    "folder_attachments",
    "folders",
    "humans",
    "organizations",
    "session_attachments",
    "session_documents",
    "session_participants",
    "session_tags",
    "sessions",
    "synced_preferences",
    "tags",
    "templates",
    "transcripts",
    "workspace_memberships",
    "workspaces",
];

const EXTENSION_GLOBAL_TABLES: &[&str] = &[
    "cloudsync_payload_fragments",
    "cloudsync_schema_versions",
    "cloudsync_settings",
    "cloudsync_site_id",
    "cloudsync_table_settings",
];

fn fixture_copy(dir: &Path) -> PathBuf {
    let path = dir.join("app.db");
    std::fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cloudsync_initialized.db"),
        &path,
    )
    .unwrap();
    path
}

async fn open(path: &Path) -> Db {
    Db::open(DbOpenOptions {
        storage: DbStorage::Local(path),
        journal_mode_wal: true,
        foreign_keys: true,
        max_connections: Some(4),
    })
    .await
    .unwrap()
}

async fn schema_objects(db: &Db) -> BTreeSet<(String, String)> {
    sqlx::query_as::<_, (String, String)>(
        "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_autoindex_%'",
    )
    .fetch_all(db.pool())
    .await
    .unwrap()
    .into_iter()
    .collect()
}

fn expected_extension_objects() -> BTreeSet<(String, String)> {
    let mut objects = BTreeSet::new();
    for table in FORMERLY_SYNCED_TABLES {
        for event in ["insert", "update", "delete"] {
            objects.insert(("trigger".into(), format!("cloudsync_after_{event}_{table}")));
        }
        objects.insert(("table".into(), format!("{table}_cloudsync")));
    }
    for table in EXTENSION_GLOBAL_TABLES {
        objects.insert(("table".into(), table.to_string()));
    }
    objects
}

async fn write_every_formerly_synced_table(db: &Db) {
    for table in FORMERLY_SYNCED_TABLES {
        let id = format!("after-detach-{table}");
        let insert = if *table == "workspace_memberships" {
            format!("INSERT INTO {table} (id, user_id) VALUES (?, 'after-detach')")
        } else {
            format!("INSERT INTO {table} (id) VALUES (?)")
        };
        sqlx::query(sqlx::AssertSqlSafe(insert))
            .bind(&id)
            .execute(db.pool())
            .await
            .unwrap_or_else(|error| panic!("insert into {table}: {error}"));
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE {table} SET id = id WHERE id IN (?, 'fixture-{table}-1')"
        )))
        .bind(&id)
        .execute(db.pool())
        .await
        .unwrap_or_else(|error| panic!("update {table}: {error}"));
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "DELETE FROM {table} WHERE id IN (?, 'fixture-{table}-1')"
        )))
        .bind(&id)
        .execute(db.pool())
        .await
        .unwrap_or_else(|error| panic!("delete from {table}: {error}"));
    }
}

#[tokio::test]
async fn legacy_cloudsync_database_migrates_and_accepts_writes_without_the_extension() {
    let dir = tempfile::tempdir().unwrap();
    let path = fixture_copy(dir.path());
    let db = open(&path).await;

    let legacy: BTreeSet<(String, String)> = db_app::legacy_cloudsync_objects(db.pool())
        .await
        .unwrap()
        .into_iter()
        .collect();
    assert_eq!(legacy, expected_extension_objects());
    let insert_before_detach = sqlx::query("INSERT INTO sessions (id) VALUES ('blocked')")
        .execute(db.pool())
        .await
        .unwrap_err();
    assert!(insert_before_detach.to_string().contains("cloudsync_"));

    db_app::prepare_schema(&db).await.unwrap();

    assert!(
        db_app::legacy_cloudsync_objects(db.pool())
            .await
            .unwrap()
            .is_empty()
    );
    let workspace_binding: Option<String> = sqlx::query_scalar(
        "SELECT json_extract(value_json, '$.workspace_id') FROM app_settings WHERE id = ?",
    )
    .bind(db_app::LOCAL_WORKSPACE_BINDING_ID)
    .fetch_optional(db.pool())
    .await
    .unwrap();
    assert_eq!(
        workspace_binding.as_deref(),
        Some("11111111-1111-4111-8111-111111111111")
    );

    write_every_formerly_synced_table(&db).await;
    sqlx::query("VACUUM").execute(db.pool()).await.unwrap();
    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(integrity, "ok");

    let fresh_dir = tempfile::tempdir().unwrap();
    let fresh = open(&fresh_dir.path().join("app.db")).await;
    db_app::prepare_schema(&fresh).await.unwrap();
    assert_eq!(schema_objects(&db).await, schema_objects(&fresh).await);

    let backup = open(&dir.path().join("app.db.cloudsync-backup")).await;
    let backed_up: BTreeSet<(String, String)> = db_app::legacy_cloudsync_objects(backup.pool())
        .await
        .unwrap()
        .into_iter()
        .collect();
    assert_eq!(backed_up, expected_extension_objects());
}

#[tokio::test]
async fn reopening_a_detached_database_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let path = fixture_copy(dir.path());
    let db = open(&path).await;
    let first = db_app::detach_legacy_cloudsync(db.pool())
        .await
        .unwrap()
        .unwrap();
    let backup = first.backup.unwrap();
    assert!(backup.is_file());
    assert_eq!(backup.file_name().unwrap(), "app.db.cloudsync-backup");
    db_app::prepare_schema(&db).await.unwrap();
    let objects = schema_objects(&db).await;
    db.pool().close().await;

    let reopened = open(&path).await;
    assert_eq!(
        db_app::detach_legacy_cloudsync(reopened.pool())
            .await
            .unwrap(),
        None
    );
    db_app::prepare_schema(&reopened).await.unwrap();
    assert_eq!(schema_objects(&reopened).await, objects);
    let backups = std::fs::read_dir(dir.path())
        .unwrap()
        .filter(|entry| {
            entry
                .as_ref()
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("backup")
        })
        .count();
    assert_eq!(backups, 1);
}

#[tokio::test]
async fn fresh_database_initializes_without_a_backup() {
    let dir = tempfile::tempdir().unwrap();
    let db = open(&dir.path().join("app.db")).await;

    assert_eq!(
        db_app::detach_legacy_cloudsync(db.pool()).await.unwrap(),
        None
    );
    db_app::prepare_schema(&db).await.unwrap();
    write_every_formerly_synced_table(&db).await;

    let files: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        files.iter().all(|file| !file.contains("backup")),
        "{files:?}"
    );
}
