use std::path::PathBuf;

// Older builds synced through the sqlite-sync extension, which installs
// triggers calling its own SQL functions on every tracked table. Without the
// extension those triggers fail every write, so they and the extension's
// metadata tables are removed before the schema is prepared. Tables created
// by app migrations (cloudsync_session_evictions, cloudsync_writable_workspaces)
// and the device workspace row in app_settings stay; they are plain data.
const EXTENSION_TABLES: &[&str] = &[
    "cloudsync_payload_fragments",
    "cloudsync_schema_versions",
    "cloudsync_settings",
    "cloudsync_site_id",
    "cloudsync_table_settings",
];

const EXTENSION_OBJECTS_SQL: &str = r"
SELECT type, name
FROM sqlite_master
WHERE (
    type = 'trigger'
    AND (
      name LIKE 'cloudsync\_after\_insert\_%' ESCAPE '\'
      OR name LIKE 'cloudsync\_before\_update\_%' ESCAPE '\'
      OR name LIKE 'cloudsync\_after\_update\_%' ESCAPE '\'
      OR name LIKE 'cloudsync\_before\_delete\_%' ESCAPE '\'
      OR name LIKE 'cloudsync\_after\_delete\_%' ESCAPE '\'
      OR instr(
        replace(replace(replace(lower(COALESCE(sql, '')),
          'cloudsync_workspace_binding', ''),
          'cloudsync_writable_workspaces', ''),
          'cloudsync_session_evictions', ''),
        'cloudsync_'
      ) > 0
    )
  )
  OR (
    type = 'table'
    AND lower(COALESCE(sql, '')) NOT LIKE 'create virtual table%'
    AND (
      name IN (SELECT value FROM json_each(?))
      OR name LIKE '%\_cloudsync' ESCAPE '\'
      OR name LIKE '%\_cloudsync\_blocks' ESCAPE '\'
    )
  )
ORDER BY type DESC, name
";

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct LegacyCloudsyncDetach {
    pub triggers: Vec<String>,
    pub tables: Vec<String>,
    pub backup: Option<PathBuf>,
}

pub async fn detach_legacy_cloudsync(
    pool: &sqlx::SqlitePool,
) -> Result<Option<LegacyCloudsyncDetach>, sqlx::Error> {
    if legacy_cloudsync_objects(pool).await?.is_empty() {
        return Ok(None);
    }

    let backup = backup_before_detach(pool).await?;

    let mut transaction = pool.begin_with("BEGIN IMMEDIATE").await?;
    let objects = legacy_cloudsync_objects(&mut *transaction).await?;
    let mut detach = LegacyCloudsyncDetach {
        backup,
        ..Default::default()
    };
    for (kind, name) in objects {
        let statement = match kind.as_str() {
            "trigger" => format!("DROP TRIGGER IF EXISTS {}", quote_identifier(&name)),
            _ => format!("DROP TABLE IF EXISTS {}", quote_identifier(&name)),
        };
        sqlx::query(sqlx::AssertSqlSafe(statement))
            .execute(&mut *transaction)
            .await?;
        if kind == "trigger" {
            detach.triggers.push(name);
        } else {
            detach.tables.push(name);
        }
    }
    transaction.commit().await?;

    tracing::info!(
        triggers = detach.triggers.len(),
        tables = detach.tables.len(),
        backup = ?detach.backup,
        "detached_legacy_cloudsync"
    );
    Ok(Some(detach))
}

pub async fn legacy_cloudsync_objects<'e, E>(
    executor: E,
) -> Result<Vec<(String, String)>, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    let extension_tables =
        serde_json::to_string(EXTENSION_TABLES).expect("static table names serialize");
    sqlx::query_as(EXTENSION_OBJECTS_SQL)
        .bind(extension_tables)
        .fetch_all(executor)
        .await
}

// A crash between the backup and the detach leaves the first backup in place;
// it is the copy taken before anything was dropped, so it is kept.
async fn backup_before_detach(pool: &sqlx::SqlitePool) -> Result<Option<PathBuf>, sqlx::Error> {
    let file: Option<String> =
        sqlx::query_scalar("SELECT file FROM pragma_database_list WHERE name = 'main'")
            .fetch_optional(pool)
            .await?;
    let Some(file) = file.filter(|file| !file.is_empty()) else {
        return Ok(None);
    };

    let backup = PathBuf::from(format!("{file}.cloudsync-backup"));
    if backup.exists() {
        return Ok(Some(backup));
    }
    sqlx::query("VACUUM INTO ?")
        .bind(backup.to_string_lossy().into_owned())
        .execute(pool)
        .await?;
    Ok(Some(backup))
}

fn quote_identifier(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}
