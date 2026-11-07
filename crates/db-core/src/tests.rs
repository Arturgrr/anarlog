use super::*;

#[tokio::test]
async fn connect_local_plain_creates_parent_dirs() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("nonexistent").join("nested").join("app.db");
    let db = Db::connect_local_plain(&db_path).await.unwrap();
    assert!(db_path.exists());
    drop(db);
}

#[tokio::test]
async fn connect_local_read_write_does_not_create_missing_database() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("missing.db");

    let result = Db::connect_local_read_write(&db_path).await;

    assert!(result.is_err());
    assert!(!db_path.exists());
}

#[tokio::test]
async fn connect_local_read_write_accepts_writes() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("app.db");
    let created = Db::connect_local_plain(&db_path).await.unwrap();
    sqlx::query("CREATE TABLE records (id TEXT PRIMARY KEY NOT NULL)")
        .execute(created.pool())
        .await
        .unwrap();
    created.pool().close().await;

    let writable = Db::connect_local_read_write(&db_path).await.unwrap();
    sqlx::query("INSERT INTO records (id) VALUES ('written')")
        .execute(writable.pool())
        .await
        .unwrap();
    let rows: Vec<String> = sqlx::query_scalar("SELECT id FROM records")
        .fetch_all(writable.pool())
        .await
        .unwrap();
    writable.pool().close().await;

    assert_eq!(rows, vec!["written"]);
}

#[tokio::test]
async fn connect_local_read_only_does_not_create_missing_database() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("missing.db");

    let result = Db::connect_local_read_only(&db_path).await;

    assert!(result.is_err());
    assert!(!db_path.exists());
}

#[tokio::test]
async fn connect_local_read_only_rejects_writes() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("app.db");
    let writable = Db::connect_local_plain(&db_path).await.unwrap();
    sqlx::query("CREATE TABLE records (id TEXT PRIMARY KEY NOT NULL)")
        .execute(writable.pool())
        .await
        .unwrap();
    sqlx::query("INSERT INTO records (id) VALUES ('existing')")
        .execute(writable.pool())
        .await
        .unwrap();
    writable.pool().close().await;

    let read_only = Db::connect_local_read_only(&db_path).await.unwrap();
    let rows: Vec<String> = sqlx::query_scalar("SELECT id FROM records ORDER BY id")
        .fetch_all(read_only.pool())
        .await
        .unwrap();
    let query_only: i64 = sqlx::query_scalar("PRAGMA query_only")
        .fetch_one(read_only.pool())
        .await
        .unwrap();
    let write_result = sqlx::query("INSERT INTO records (id) VALUES ('rejected')")
        .execute(read_only.pool())
        .await;

    assert_eq!(rows, vec!["existing"]);
    assert_eq!(query_only, 1);
    assert!(write_result.is_err());
}

#[tokio::test]
async fn open_applies_requested_pragmas() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("app.db");

    let db = Db::open(DbOpenOptions {
        storage: DbStorage::Local(&db_path),
        journal_mode_wal: true,
        foreign_keys: true,
        max_connections: Some(1),
    })
    .await
    .unwrap();

    let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
        .fetch_one(db.pool())
        .await
        .unwrap();
    let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode")
        .fetch_one(db.pool())
        .await
        .unwrap();
    let busy_timeout: i64 = sqlx::query_scalar("PRAGMA busy_timeout")
        .fetch_one(db.pool())
        .await
        .unwrap();

    assert_eq!(foreign_keys, 1);
    assert_eq!(journal_mode.to_lowercase(), "wal");
    assert_eq!(busy_timeout, SQLITE_BUSY_TIMEOUT.as_millis() as i64);
}

#[tokio::test]
async fn emits_table_changes_for_local_writes() {
    let db = Db::connect_memory_plain().await.unwrap();
    let notifier = db.change_notifier();
    sqlx::query("CREATE TABLE test_events (id TEXT PRIMARY KEY NOT NULL)")
        .execute(db.pool())
        .await
        .unwrap();

    let mut changes = notifier.subscribe();
    let before = notifier.current_seq();

    sqlx::query("INSERT INTO test_events (id) VALUES ('a')")
        .execute(db.pool())
        .await
        .unwrap();

    let change = tokio::time::timeout(std::time::Duration::from_secs(1), changes.recv())
        .await
        .unwrap()
        .unwrap();

    assert_eq!(change.table, "test_events");
    assert_eq!(change.kind, anlg_db_change::TableChangeKind::Insert);
    assert!(change.seq > before);
    assert_eq!(notifier.current_seq(), change.seq);
    assert_eq!(notifier.latest_table_seq("test_events"), Some(change.seq));
}

#[tokio::test]
async fn emits_table_changes_only_after_commit() {
    let db = Db::connect_memory_plain().await.unwrap();
    let notifier = db.change_notifier();
    sqlx::query("CREATE TABLE test_events (id TEXT PRIMARY KEY NOT NULL)")
        .execute(db.pool())
        .await
        .unwrap();

    let mut changes = notifier.subscribe();
    let mut tx = db.pool().begin().await.unwrap();

    sqlx::query("INSERT INTO test_events (id) VALUES ('a')")
        .execute(&mut *tx)
        .await
        .unwrap();

    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), changes.recv())
            .await
            .is_err()
    );

    tx.commit().await.unwrap();

    let change = tokio::time::timeout(std::time::Duration::from_secs(1), changes.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(change.table, "test_events");
    assert_eq!(change.kind, anlg_db_change::TableChangeKind::Insert);
    assert_eq!(notifier.latest_table_seq("test_events"), Some(change.seq));
}

#[tokio::test]
async fn rollback_clears_pending_table_changes() {
    let db = Db::connect_memory_plain().await.unwrap();
    let notifier = db.change_notifier();
    sqlx::query("CREATE TABLE test_events (id TEXT PRIMARY KEY NOT NULL)")
        .execute(db.pool())
        .await
        .unwrap();

    let mut changes = notifier.subscribe();
    let mut tx = db.pool().begin().await.unwrap();

    sqlx::query("INSERT INTO test_events (id) VALUES ('a')")
        .execute(&mut *tx)
        .await
        .unwrap();

    tx.rollback().await.unwrap();

    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), changes.recv())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn coalesces_multiple_writes_in_a_transaction() {
    let db = Db::connect_memory_plain().await.unwrap();
    let notifier = db.change_notifier();
    sqlx::query("CREATE TABLE test_events (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)")
        .execute(db.pool())
        .await
        .unwrap();

    let mut changes = notifier.subscribe();
    let mut tx = db.pool().begin().await.unwrap();

    sqlx::query("INSERT INTO test_events (id, value) VALUES ('a', 'before')")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("UPDATE test_events SET value = 'after' WHERE id = 'a'")
        .execute(&mut *tx)
        .await
        .unwrap();

    tx.commit().await.unwrap();

    let change = tokio::time::timeout(std::time::Duration::from_secs(1), changes.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(change.table, "test_events");
    assert_eq!(change.kind, anlg_db_change::TableChangeKind::Update);
    assert_eq!(notifier.latest_table_seq("test_events"), Some(change.seq));
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), changes.recv())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn emits_update_and_delete_table_changes() {
    let db = Db::connect_memory_plain().await.unwrap();
    let notifier = db.change_notifier();
    sqlx::query("CREATE TABLE test_events (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)")
        .execute(db.pool())
        .await
        .unwrap();
    sqlx::query("INSERT INTO test_events (id, value) VALUES ('a', 'before')")
        .execute(db.pool())
        .await
        .unwrap();

    let mut changes = notifier.subscribe();

    sqlx::query("UPDATE test_events SET value = 'after' WHERE id = 'a'")
        .execute(db.pool())
        .await
        .unwrap();
    sqlx::query("DELETE FROM test_events WHERE id = 'a'")
        .execute(db.pool())
        .await
        .unwrap();

    let update = tokio::time::timeout(std::time::Duration::from_secs(1), changes.recv())
        .await
        .unwrap()
        .unwrap();
    let delete = tokio::time::timeout(std::time::Duration::from_secs(1), changes.recv())
        .await
        .unwrap()
        .unwrap();

    assert_eq!(update.table, "test_events");
    assert_eq!(update.kind, anlg_db_change::TableChangeKind::Update);
    assert_eq!(delete.table, "test_events");
    assert_eq!(delete.kind, anlg_db_change::TableChangeKind::Delete);
    assert!(delete.seq > update.seq);
    assert_eq!(notifier.latest_table_seq("test_events"), Some(delete.seq));
}

#[tokio::test]
async fn emits_table_changes_across_multiple_connections() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("app.db");

    let db = Db::open(DbOpenOptions {
        storage: DbStorage::Local(&db_path),
        journal_mode_wal: true,
        foreign_keys: true,
        max_connections: Some(4),
    })
    .await
    .unwrap();
    let notifier = db.change_notifier();
    sqlx::query("CREATE TABLE multi_conn_events (id TEXT PRIMARY KEY NOT NULL)")
        .execute(db.pool())
        .await
        .unwrap();

    let mut changes = notifier.subscribe();
    let mut conn_a = db.pool().acquire().await.unwrap();
    let mut conn_b = db.pool().acquire().await.unwrap();

    sqlx::query("INSERT INTO multi_conn_events (id) VALUES ('a')")
        .execute(&mut *conn_a)
        .await
        .unwrap();
    sqlx::query("INSERT INTO multi_conn_events (id) VALUES ('b')")
        .execute(&mut *conn_b)
        .await
        .unwrap();

    let first = tokio::time::timeout(std::time::Duration::from_secs(1), changes.recv())
        .await
        .unwrap()
        .unwrap();
    let second = tokio::time::timeout(std::time::Duration::from_secs(1), changes.recv())
        .await
        .unwrap()
        .unwrap();

    assert_eq!(first.table, "multi_conn_events");
    assert_eq!(second.table, "multi_conn_events");
    assert_ne!(first.seq, second.seq);
}

#[tokio::test]
async fn tracks_monotonic_change_sequences_per_table() {
    let db = Db::connect_memory_plain().await.unwrap();
    let notifier = db.change_notifier();
    sqlx::query("CREATE TABLE test_events (id TEXT PRIMARY KEY NOT NULL)")
        .execute(db.pool())
        .await
        .unwrap();
    sqlx::query("CREATE TABLE other_events (id TEXT PRIMARY KEY NOT NULL)")
        .execute(db.pool())
        .await
        .unwrap();

    let start = notifier.current_seq();
    let mut changes = notifier.subscribe();

    sqlx::query("INSERT INTO test_events (id) VALUES ('a')")
        .execute(db.pool())
        .await
        .unwrap();
    let first = tokio::time::timeout(std::time::Duration::from_secs(1), changes.recv())
        .await
        .unwrap()
        .unwrap();

    sqlx::query("INSERT INTO test_events (id) VALUES ('b')")
        .execute(db.pool())
        .await
        .unwrap();
    let second = tokio::time::timeout(std::time::Duration::from_secs(1), changes.recv())
        .await
        .unwrap()
        .unwrap();

    sqlx::query("INSERT INTO other_events (id) VALUES ('c')")
        .execute(db.pool())
        .await
        .unwrap();
    let third = tokio::time::timeout(std::time::Duration::from_secs(1), changes.recv())
        .await
        .unwrap()
        .unwrap();

    assert!(first.seq > start);
    assert!(second.seq > first.seq);
    assert!(third.seq > second.seq);
    assert_eq!(notifier.current_seq(), third.seq);
    assert_eq!(notifier.latest_table_seq("test_events"), Some(second.seq));
    assert_eq!(notifier.latest_table_seq("other_events"), Some(third.seq));
    assert_eq!(notifier.latest_table_seq("missing_events"), None);
}

#[tokio::test]
async fn notifier_survives_db_drop() {
    let db = Db::connect_memory_plain().await.unwrap();
    let notifier = db.change_notifier().clone();
    sqlx::query("CREATE TABLE retained_events (id TEXT PRIMARY KEY NOT NULL)")
        .execute(db.pool())
        .await
        .unwrap();

    let pool = db.pool().clone();
    let mut changes = notifier.subscribe();
    drop(db);

    sqlx::query("INSERT INTO retained_events (id) VALUES ('a')")
        .execute(&pool)
        .await
        .unwrap();

    let change = tokio::time::timeout(std::time::Duration::from_secs(1), changes.recv())
        .await
        .unwrap()
        .unwrap();

    assert_eq!(change.table, "retained_events");
    assert_eq!(change.kind, anlg_db_change::TableChangeKind::Insert);
    assert_eq!(
        notifier.latest_table_seq("retained_events"),
        Some(change.seq)
    );
}

#[tokio::test]
async fn open_memory_clamps_max_connections_to_one() {
    let db = Db::open(DbOpenOptions {
        storage: DbStorage::Memory,
        journal_mode_wal: false,
        foreign_keys: true,
        max_connections: Some(4),
    })
    .await
    .unwrap();

    let _conn = db.pool().acquire().await.unwrap();

    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), db.pool().acquire())
            .await
            .is_err()
    );
}
