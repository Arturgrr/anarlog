use sqlx::SqliteConnection;

pub async fn insert_session(
    conn: &mut SqliteConnection,
    session_id: &str,
    title: &str,
    user_id: &str,
    event_json: &str,
    folder_path: &str,
    now: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "INSERT INTO sessions (
          id, workspace_id, owner_user_id, title, event_json, folder_path,
          created_at, updated_at, deleted_at
        ) VALUES (
          ?, NULLIF((
            SELECT json_extract(value_json, '$.workspace_id')
            FROM app_settings
            WHERE id = 'cloudsync_workspace_binding'
          ), ''), COALESCE(
            (SELECT library_workspace_id FROM local_library_connections WHERE active = 1),
            NULLIF(NULLIF(?, ''), '00000000-0000-0000-0000-000000000000'),
            NULLIF((
              SELECT json_extract(value_json, '$.workspace_id')
              FROM app_settings
              WHERE id = 'cloudsync_workspace_binding'
            ), '')
          ), ?, ?, ?, ?, ?, NULL
        )",
    )
    .bind(session_id)
    .bind(user_id)
    .bind(title)
    .bind(event_json)
    .bind(folder_path)
    .bind(now)
    .bind(now)
    .execute(&mut *conn)
    .await?;

    Ok(result.rows_affected())
}

pub async fn insert_empty_session_note(
    conn: &mut SqliteConnection,
    session_id: &str,
    body: &str,
    now: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "INSERT INTO session_documents (
          id, workspace_id, session_id, kind, body_format, body, created_by,
          updated_by, created_at, updated_at, deleted_at
        )
        SELECT ?, workspace_id, id, 'note', 'prosemirror_json', ?,
          owner_user_id, owner_user_id, ?, ?, NULL
        FROM sessions
        WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(session_id)
    .bind(body)
    .bind(now)
    .bind(now)
    .bind(session_id)
    .execute(&mut *conn)
    .await?;

    Ok(result.rows_affected())
}

pub async fn upsert_session_owner_human(
    conn: &mut SqliteConnection,
    session_id: &str,
    now: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "INSERT INTO humans (
          id, workspace_id, owner_user_id, updated_at, deleted_at
        )
        SELECT session.owner_user_id, session.workspace_id,
          session.owner_user_id, ?, NULL
        FROM sessions AS session
        WHERE session.id = ? AND session.deleted_at IS NULL
        ON CONFLICT(id) DO UPDATE SET
          deleted_at = NULL,
          updated_at = excluded.updated_at",
    )
    .bind(now)
    .bind(session_id)
    .execute(&mut *conn)
    .await?;

    Ok(result.rows_affected())
}

pub async fn insert_owner_session_participant(
    conn: &mut SqliteConnection,
    participant_id: &str,
    session_id: &str,
    now: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "INSERT INTO session_participants (
          id, workspace_id, owner_user_id, session_id, human_id, source,
          created_at, updated_at, deleted_at
        )
        SELECT ?, session.workspace_id, session.owner_user_id, session.id,
          session.owner_user_id, 'manual', ?, ?, NULL
        FROM sessions AS session
        WHERE session.id = ? AND session.deleted_at IS NULL",
    )
    .bind(participant_id)
    .bind(now)
    .bind(now)
    .bind(session_id)
    .execute(&mut *conn)
    .await?;

    Ok(result.rows_affected())
}

pub struct SessionDeleteRow {
    pub id: String,
    pub title: String,
}

pub async fn load_session_delete_row(
    conn: &mut SqliteConnection,
    session_id: &str,
) -> Result<Option<SessionDeleteRow>, sqlx::Error> {
    let row = sqlx::query_as::<_, (String, String)>(
        "SELECT id, title FROM sessions WHERE id = ? AND deleted_at IS NULL LIMIT 1",
    )
    .bind(session_id)
    .fetch_optional(&mut *conn)
    .await?;

    Ok(row.map(|(id, title)| SessionDeleteRow { id, title }))
}

pub async fn session_is_alive(
    conn: &mut SqliteConnection,
    session_id: &str,
) -> Result<bool, sqlx::Error> {
    let id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM sessions WHERE id = ? AND deleted_at IS NULL LIMIT 1",
    )
    .bind(session_id)
    .fetch_optional(&mut *conn)
    .await?;

    Ok(id.is_some())
}

pub async fn update_session_child_tombstone(
    conn: &mut SqliteConnection,
    table: &str,
    session_id: &str,
    tombstone: &str,
    restore: bool,
) -> Result<u64, sqlx::Error> {
    let predicate = if restore {
        "deleted_at = ?"
    } else {
        "deleted_at IS NULL"
    };
    let sql = format!(
        "UPDATE {table}
        SET deleted_at = ?, updated_at = ?
        WHERE session_id = ? AND {predicate}"
    );
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql));
    if restore {
        query = query.bind(Option::<&str>::None);
    } else {
        query = query.bind(tombstone);
    }
    let mut query = query.bind(tombstone).bind(session_id);
    if restore {
        query = query.bind(tombstone);
    }
    let result = query.execute(&mut *conn).await?;

    Ok(result.rows_affected())
}

pub async fn update_entity_mentions_tombstone(
    conn: &mut SqliteConnection,
    session_id: &str,
    tombstone: &str,
    restore: bool,
) -> Result<u64, sqlx::Error> {
    let predicate = if restore {
        "deleted_at = ?"
    } else {
        "deleted_at IS NULL"
    };
    let sql = format!(
        "UPDATE entity_mentions
        SET deleted_at = ?, updated_at = ?
        WHERE (
          (source_type = 'session' AND source_id = ?)
          OR (target_type = 'session' AND target_id = ?)
        ) AND {predicate}"
    );
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql));
    if restore {
        query = query.bind(Option::<&str>::None);
    } else {
        query = query.bind(tombstone);
    }
    let mut query = query.bind(tombstone).bind(session_id).bind(session_id);
    if restore {
        query = query.bind(tombstone);
    }
    let result = query.execute(&mut *conn).await?;

    Ok(result.rows_affected())
}

pub async fn update_sessions_tombstone(
    conn: &mut SqliteConnection,
    session_id: &str,
    tombstone: &str,
    restore: bool,
) -> Result<u64, sqlx::Error> {
    let predicate = if restore {
        "deleted_at = ?"
    } else {
        "deleted_at IS NULL"
    };
    let sql = format!(
        "UPDATE sessions
        SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND {predicate}"
    );
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql));
    if restore {
        query = query.bind(Option::<&str>::None);
    } else {
        query = query.bind(tombstone);
    }
    let mut query = query.bind(tombstone).bind(session_id);
    if restore {
        query = query.bind(tombstone);
    }
    let result = query.execute(&mut *conn).await?;

    Ok(result.rows_affected())
}
