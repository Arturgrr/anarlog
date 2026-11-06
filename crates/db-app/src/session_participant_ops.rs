use sqlx::SqliteConnection;

pub async fn revive_excluded_session_participant(
    conn: &mut SqliteConnection,
    session_id: &str,
    human_id: &str,
    source: &str,
    now: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE session_participants
        SET source = ?, updated_at = ?
        WHERE id = (
          SELECT id
          FROM session_participants
          WHERE session_id = ?
            AND human_id = ?
            AND source = 'excluded'
            AND deleted_at IS NULL
            AND ? <> 'auto'
          ORDER BY created_at, id
          LIMIT 1
        )",
    )
    .bind(source)
    .bind(now)
    .bind(session_id)
    .bind(human_id)
    .bind(source)
    .execute(&mut *conn)
    .await?;

    Ok(result.rows_affected())
}

pub async fn insert_manual_session_participant(
    conn: &mut SqliteConnection,
    participant_id: &str,
    session_id: &str,
    human_id: &str,
    source: &str,
    now: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "INSERT INTO session_participants (
          id, workspace_id, owner_user_id, session_id, human_id,
          display_name, email, role, source, metadata_json, created_at,
          updated_at, deleted_at
        )
        SELECT ?, session.workspace_id, session.owner_user_id, session.id, human.id,
          human.name, human.email, '', ?, '{}', ?, ?, NULL
        FROM sessions AS session
        JOIN humans AS human ON human.id = ? AND human.deleted_at IS NULL
        WHERE session.id = ?
          AND session.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM session_participants AS existing
            WHERE existing.session_id = session.id
              AND existing.human_id = human.id
              AND existing.deleted_at IS NULL
          )",
    )
    .bind(participant_id)
    .bind(source)
    .bind(now)
    .bind(now)
    .bind(human_id)
    .bind(session_id)
    .execute(&mut *conn)
    .await?;

    Ok(result.rows_affected())
}

pub async fn remove_session_participant_mapping(
    conn: &mut SqliteConnection,
    mapping_id: &str,
    now: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE session_participants
        SET
          source = CASE WHEN source = 'auto' THEN 'excluded' ELSE source END,
          deleted_at = CASE WHEN source = 'auto' THEN NULL ELSE ? END,
          updated_at = ?
        WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(now)
    .bind(now)
    .bind(mapping_id)
    .execute(&mut *conn)
    .await?;

    Ok(result.rows_affected())
}
