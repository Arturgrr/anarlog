#[tokio::test]
async fn open_app_db_opens_a_database_left_by_cloudsync() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("app.db");
    std::fs::copy(
        concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../crates/db-app/tests/fixtures/cloudsync_initialized.db"
        ),
        &db_path,
    )
    .unwrap();

    let db = crate::open_app_db(Some(&db_path)).await.unwrap();

    sqlx::query("INSERT INTO sessions (id, title) VALUES ('session-1', 'After sync')")
        .execute(db.pool())
        .await
        .unwrap();
    assert!(
        anlg_db_app::legacy_cloudsync_objects(db.pool())
            .await
            .unwrap()
            .is_empty()
    );
}
