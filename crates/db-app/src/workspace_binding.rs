// The id predates the local-only build. Shipped migrations, triggers, and
// insert helpers read the device workspace from this row by name, and rows
// written without it would fail their NOT NULL workspace columns.
pub const LOCAL_WORKSPACE_BINDING_ID: &str = "cloudsync_workspace_binding";

pub const DEFAULT_USER_ID: &str = "00000000-0000-0000-0000-000000000000";

pub async fn ensure_local_workspace_binding(pool: &sqlx::SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO app_settings (id, value_json)
         VALUES (?, json_object('workspace_id', ?, 'account_user_id', NULL))
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(LOCAL_WORKSPACE_BINDING_ID)
    .bind(uuid::Uuid::new_v4().to_string())
    .execute(pool)
    .await?;
    Ok(())
}
