use std::path::Path;

use anlg_db_core::{Db, DbOpenOptions, DbStorage};

use crate::Result;

pub async fn open_app_db(db_path: Option<&Path>) -> Result<Db> {
    open_app_db_with(db_path, true).await
}

pub async fn open_app_db_unmigrated(db_path: Option<&Path>) -> Result<Db> {
    open_app_db_with(db_path, false).await
}

async fn open_app_db_with(db_path: Option<&Path>, prepare_schema: bool) -> Result<Db> {
    let storage = match db_path {
        Some(path) => DbStorage::Local(path),
        None => DbStorage::Memory,
    };

    let db = Db::open(DbOpenOptions {
        storage,
        journal_mode_wal: true,
        foreign_keys: true,
        max_connections: Some(4),
    })
    .await?;
    if prepare_schema && let Err(error) = anlg_db_app::prepare_schema(&db).await {
        db.pool().close().await;
        return Err(error.into());
    }
    Ok(db)
}
