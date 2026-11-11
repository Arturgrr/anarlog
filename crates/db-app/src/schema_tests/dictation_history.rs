use super::*;

const MIGRATION: &str = "20261111120000_dictation_history";

#[tokio::test]
async fn dictation_history_migration_upgrades_in_place_and_older_builds_still_open_it() {
    let db = Db::connect_memory_plain().await.unwrap();
    let older = anlg_db_migrate::DbSchema {
        steps: migration_steps_before(MIGRATION),
    };
    anlg_db_migrate::migrate(&db, older).await.unwrap();
    sqlx::query("INSERT INTO sessions (id, title) VALUES ('session-1', 'Kept')")
        .execute(db.pool())
        .await
        .unwrap();

    anlg_db_migrate::migrate(&db, schema()).await.unwrap();

    let title: String = sqlx::query_scalar("SELECT title FROM sessions WHERE id = 'session-1'")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(title, "Kept");
    sqlx::query("INSERT INTO dictation_history (id, final_text) VALUES ('dictation-1', 'Hello')")
        .execute(db.pool())
        .await
        .unwrap();
    let row: (String, i64, i64, Option<String>, String) = sqlx::query_as(
        "SELECT created_at, duration_ms, inserted, audio_path, versions_json
         FROM dictation_history WHERE id = 'dictation-1'",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert!(!row.0.is_empty());
    assert_eq!((row.1, row.2, row.3, row.4.as_str()), (0, 0, None, "[]"));

    anlg_db_migrate::migrate(&db, older).await.unwrap();
}

#[tokio::test]
async fn dictation_history_writes_never_reach_search_or_sync_queues() {
    let db = test_db().await;
    sqlx::raw_sql(
        "INSERT INTO app_settings (id, value_json) VALUES
           ('cloudsync_workspace_binding', '{\"workspace_id\":\"workspace-a\"}')
           ON CONFLICT (id) DO UPDATE SET value_json = excluded.value_json;
         INSERT INTO dictation_history (id, raw_text, final_text, inserted, audio_path)
           VALUES ('dictation-1', 'hello', 'Hello.', 1, 'dictation-1.wav');
         UPDATE dictation_history SET final_text = 'Hi.' WHERE id = 'dictation-1';
         DELETE FROM dictation_history WHERE id = 'dictation-1';",
    )
    .execute(db.pool())
    .await
    .unwrap();

    let (search, sync): (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM search_index_dirty),
                (SELECT count(*) FROM e2ee_dirty_rows)",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!((search, sync), (0, 0));
}
