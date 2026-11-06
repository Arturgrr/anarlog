use serde::{Deserialize, Serialize};
use specta::Type;
use sqlx::SqlitePool;

use crate::transaction_utils::js_iso8601_timestamp;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct CreateSessionRequest {
    pub title: String,
    pub user_id: String,
    pub event_json: String,
    pub folder_path: String,
    pub raw_md: String,
}

pub async fn create_session(
    pool: &SqlitePool,
    request: CreateSessionRequest,
) -> Result<String, String> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let participant_id = uuid::Uuid::new_v4().to_string();
    let now = js_iso8601_timestamp();
    let mut transaction = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|error| error.to_string())?;

    anlg_db_app::insert_session(
        &mut transaction,
        &session_id,
        &request.title,
        &request.user_id,
        &request.event_json,
        &request.folder_path,
        &now,
    )
    .await
    .map_err(|error| error.to_string())?;
    anlg_db_app::insert_empty_session_note(&mut transaction, &session_id, &request.raw_md, &now)
        .await
        .map_err(|error| error.to_string())?;
    anlg_db_app::upsert_session_owner_human(&mut transaction, &session_id, &now)
        .await
        .map_err(|error| error.to_string())?;
    anlg_db_app::insert_owner_session_participant(
        &mut transaction,
        &participant_id,
        &session_id,
        &now,
    )
    .await
    .map_err(|error| error.to_string())?;

    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())?;

    Ok(session_id)
}
