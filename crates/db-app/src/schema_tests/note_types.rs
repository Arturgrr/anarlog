use super::*;

const MIGRATION: &str = "20261113120000_note_types";

#[tokio::test]
async fn note_types_migration_keeps_existing_sessions_untyped_and_older_builds_open_it() {
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

    let session: (String, String, String) = sqlx::query_as(
        "SELECT title, note_type_id, note_subtype_id FROM sessions WHERE id = 'session-1'",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(
        (session.0.as_str(), session.1.as_str(), session.2.as_str()),
        ("Kept", "", "")
    );

    sqlx::raw_sql(
        "INSERT INTO note_types (id, name) VALUES ('type-1', 'Aula');
         INSERT INTO note_types (id, parent_id, name)
           VALUES ('subtype-1', 'type-1', 'Estatística e probabilidade');
         UPDATE sessions SET note_type_id = 'type-1', note_subtype_id = 'subtype-1'
           WHERE id = 'session-1';",
    )
    .execute(db.pool())
    .await
    .unwrap();
    let types: Vec<(String, String, i64, Option<String>)> = sqlx::query_as(
        "SELECT id, parent_id, sort_order, deleted_at FROM note_types ORDER BY id DESC",
    )
    .fetch_all(db.pool())
    .await
    .unwrap();
    assert_eq!(
        types,
        vec![
            ("type-1".into(), String::new(), 0, None),
            ("subtype-1".into(), "type-1".into(), 0, None),
        ]
    );

    anlg_db_migrate::migrate(&db, older).await.unwrap();
}
