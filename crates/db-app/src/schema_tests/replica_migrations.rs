use super::*;

#[tokio::test]
async fn synced_preferences_migration_backfills_settings_and_marks_them_dirty() {
    let db = Db::connect_memory_plain().await.unwrap();
    anlg_db_migrate::migrate(
        &db,
        anlg_db_migrate::DbSchema {
            steps: migration_steps_before("20260810120000_synced_preferences"),
        },
    )
    .await
    .unwrap();

    sqlx::raw_sql(
        "INSERT INTO app_settings (id, value_json, updated_at) VALUES
           ('cloudsync_workspace_binding', '{\"workspace_id\":\"workspace-a\"}', '2026-08-10T00:00:00Z'),
           ('theme', '\"dark\"', '2026-08-01T00:00:00Z'),
           ('app_icon', '\"anagram\"', '2026-08-02T00:00:00Z'),
           ('microphone_device', '\"builtin\"', '2026-08-03T00:00:00Z')",
    )
    .execute(db.pool())
    .await
    .unwrap();

    anlg_db_migrate::migrate(&db, schema()).await.unwrap();

    let preferences: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT id, workspace_id, value_json, updated_at
             FROM synced_preferences
             ORDER BY id",
    )
    .fetch_all(db.pool())
    .await
    .unwrap();
    assert_eq!(
        preferences,
        vec![
            (
                "app_icon".to_string(),
                "workspace-a".to_string(),
                "\"anagram\"".to_string(),
                "2026-08-02T00:00:00Z".to_string(),
            ),
            (
                "theme".to_string(),
                "workspace-a".to_string(),
                "\"dark\"".to_string(),
                "2026-08-01T00:00:00Z".to_string(),
            ),
        ]
    );

    let dirty_rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT workspace_id, row_id
             FROM e2ee_dirty_rows
             WHERE table_name = 'synced_preferences'
             ORDER BY row_id",
    )
    .fetch_all(db.pool())
    .await
    .unwrap();
    assert_eq!(
        dirty_rows,
        vec![
            ("workspace-a".to_string(), "app_icon".to_string()),
            ("workspace-a".to_string(), "theme".to_string()),
        ]
    );
}

#[tokio::test]
async fn synced_preferences_backfill_is_skipped_without_a_workspace_binding() {
    let db = Db::connect_memory_plain().await.unwrap();
    anlg_db_migrate::migrate(
        &db,
        anlg_db_migrate::DbSchema {
            steps: migration_steps_before("20260810120000_synced_preferences"),
        },
    )
    .await
    .unwrap();

    sqlx::query("INSERT INTO app_settings (id, value_json) VALUES ('theme', '\"dark\"')")
        .execute(db.pool())
        .await
        .unwrap();

    anlg_db_migrate::migrate(&db, schema()).await.unwrap();

    let preference_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM synced_preferences")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(preference_count, 0);
}

async fn e2ee_schema_objects(db: &Db) -> Vec<(String, String, String)> {
    sqlx::query_as(
        "SELECT type, name, sql FROM sqlite_master
         WHERE type IN ('view', 'trigger') AND name LIKE 'e2ee_%'
         ORDER BY type, name",
    )
    .fetch_all(db.pool())
    .await
    .unwrap()
}

#[tokio::test]
async fn torn_e2ee_payload_hash_local_state_migration_is_repaired() {
    let migration_sql =
        include_str!("../../migrations/20260816100100_e2ee_payload_hash_local_state.sql");
    let clean_db = test_db().await;

    // A pre-transactional 1.4.10 runner force-quit mid-migration leaves the
    // column dropped with no history row: either nothing recreated yet, or
    // some views/triggers (including a non-IF-EXISTS trigger) already back.
    for cut_marker in [
        "CREATE VIEW e2ee_local_state_resolved",
        "CREATE TRIGGER e2ee_replica_payload_hash_update",
    ] {
        let db = Db::connect_memory_plain().await.unwrap();
        anlg_db_migrate::migrate(
            &db,
            anlg_db_migrate::DbSchema {
                steps: migration_steps_before("20260816100100_e2ee_payload_hash_local_state"),
            },
        )
        .await
        .unwrap();

        let cut = migration_sql.find(cut_marker).unwrap();
        sqlx::raw_sql(sqlx::AssertSqlSafe(&migration_sql[..cut]))
            .execute(db.pool())
            .await
            .unwrap();

        prepare_schema(&db).await.unwrap();

        let (success, checksum): (bool, Vec<u8>) = sqlx::query_as(
            "SELECT success, checksum FROM _sqlx_migrations WHERE version = 20260816100100",
        )
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert!(success);
        assert_eq!(checksum, migration_checksum(migration_sql));

        let payload_hash_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1 FROM pragma_table_info('e2ee_records') WHERE name = 'payload_hash'
            )",
        )
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert!(!payload_hash_exists);

        assert_eq!(
            e2ee_schema_objects(&db).await,
            e2ee_schema_objects(&clean_db).await
        );
    }
}

#[tokio::test]
async fn e2ee_payload_hash_repair_ignores_databases_before_the_column_existed() {
    let db = Db::connect_memory_plain().await.unwrap();
    anlg_db_migrate::migrate(
        &db,
        anlg_db_migrate::DbSchema {
            steps: migration_steps_before("20260815100300_e2ee_record_payload_hash"),
        },
    )
    .await
    .unwrap();

    repair_torn_e2ee_payload_hash_local_state_migration(db.pool())
        .await
        .unwrap();

    let row_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM _sqlx_migrations WHERE version = 20260816100100)",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert!(
        !row_exists,
        "repair must not pre-record an unapplied migration"
    );

    prepare_schema(&db).await.unwrap();
}

#[tokio::test]
async fn e2ee_payload_hash_repair_leaves_cleanly_migrated_databases_alone() {
    let db = test_db().await;
    let before = e2ee_schema_objects(&db).await;
    let checksum_before: Vec<u8> =
        sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version = 20260816100100")
            .fetch_one(db.pool())
            .await
            .unwrap();

    repair_torn_e2ee_payload_hash_local_state_migration(db.pool())
        .await
        .unwrap();

    let checksum_after: Vec<u8> =
        sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version = 20260816100100")
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(checksum_before, checksum_after);
    assert_eq!(before, e2ee_schema_objects(&db).await);
}

#[tokio::test]
async fn prepare_schema_skips_net_zero_e2ee_payload_hash_alters() {
    let clean_db = test_db().await;
    let db = Db::connect_memory_plain().await.unwrap();
    anlg_db_migrate::migrate(
        &db,
        anlg_db_migrate::DbSchema {
            steps: migration_steps_before("20260815100300_e2ee_record_payload_hash"),
        },
    )
    .await
    .unwrap();

    prepare_schema(&db).await.unwrap();

    let add_applied: bool = sqlx::query_scalar(
        "SELECT EXISTS(
            SELECT 1 FROM _sqlx_migrations WHERE version = 20260815100300 AND success = 1
        )",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    let drop_applied: bool = sqlx::query_scalar(
        "SELECT EXISTS(
            SELECT 1 FROM _sqlx_migrations WHERE version = 20260816100100 AND success = 1
        )",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert!(add_applied);
    assert!(drop_applied);

    let payload_hash_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(
            SELECT 1 FROM pragma_table_info('e2ee_records') WHERE name = 'payload_hash'
        )",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert!(!payload_hash_exists);
    assert_eq!(
        e2ee_schema_objects(&db).await,
        e2ee_schema_objects(&clean_db).await
    );
}

#[tokio::test]
async fn prepare_schema_still_drops_an_already_applied_payload_hash_column() {
    let db = Db::connect_memory_plain().await.unwrap();
    anlg_db_migrate::migrate(
        &db,
        anlg_db_migrate::DbSchema {
            steps: migration_steps_before("20260816100100_e2ee_payload_hash_local_state"),
        },
    )
    .await
    .unwrap();

    let payload_hash_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(
            SELECT 1 FROM pragma_table_info('e2ee_records') WHERE name = 'payload_hash'
        )",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert!(payload_hash_exists);

    prepare_schema(&db).await.unwrap();

    let payload_hash_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(
            SELECT 1 FROM pragma_table_info('e2ee_records') WHERE name = 'payload_hash'
        )",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert!(!payload_hash_exists);
}
