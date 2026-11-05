use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Connection, SqlitePool};

#[derive(Clone, Copy, Debug)]
pub enum DbStorage<'a> {
    Local(&'a Path),
    Memory,
}

#[derive(Clone, Copy, Debug)]
pub struct DbOpenOptions<'a> {
    pub storage: DbStorage<'a>,
    pub journal_mode_wal: bool,
    pub foreign_keys: bool,
    pub max_connections: Option<u32>,
}

#[derive(Debug, thiserror::Error)]
pub enum DbOpenError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
}

pub type ManagedDb = std::sync::Arc<Db>;

const SQLITE_BUSY_TIMEOUT: Duration = Duration::from_secs(5);

pub struct Db {
    pool: SqlitePool,
    change_notifier: anlg_db_change::ChangeNotifier,
}

impl std::fmt::Debug for Db {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Db").finish_non_exhaustive()
    }
}

impl Db {
    pub async fn open(options: DbOpenOptions<'_>) -> Result<Self, DbOpenError> {
        let (change_notifier, pool_options) = anlg_db_change::ChangeNotifier::new();
        connect_with_options(&options, pool_options, change_notifier).await
    }

    pub fn change_notifier(&self) -> &anlg_db_change::ChangeNotifier {
        &self.change_notifier
    }

    pub async fn connect_local_plain(path: impl AsRef<Path>) -> Result<Self, sqlx::Error> {
        if let Some(parent) = path.as_ref().parent() {
            std::fs::create_dir_all(parent).map_err(sqlx::Error::Io)?;
        }
        let options = apply_internal_connect_policy(SqliteConnectOptions::new())
            .filename(path)
            .create_if_missing(true)
            .pragma("foreign_keys", "ON");
        let (change_notifier, pool_options) = anlg_db_change::ChangeNotifier::new();
        let pool = apply_internal_pool_policy(pool_options)
            .connect_with(options)
            .await?;

        Ok(Self {
            pool,
            change_notifier,
        })
    }

    pub async fn connect_local_read_write(path: impl AsRef<Path>) -> Result<Self, sqlx::Error> {
        let path = path.as_ref();
        if !path.is_file() {
            return Err(sqlx::Error::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("database file not found: {}", path.display()),
            )));
        }

        let options = apply_internal_connect_policy(SqliteConnectOptions::new())
            .filename(path)
            .create_if_missing(false)
            .pragma("foreign_keys", "ON")
            .pragma("journal_mode", "WAL");
        let (change_notifier, pool_options) = anlg_db_change::ChangeNotifier::new();
        let pool = apply_internal_pool_policy(pool_options)
            .connect_with(options)
            .await?;

        Ok(Self {
            pool,
            change_notifier,
        })
    }

    pub async fn connect_local_read_only(path: impl AsRef<Path>) -> Result<Self, sqlx::Error> {
        let options = apply_internal_connect_policy(SqliteConnectOptions::new())
            .filename(path)
            .read_only(true)
            .pragma("foreign_keys", "ON")
            .pragma("query_only", "ON");
        let (change_notifier, pool_options) = anlg_db_change::ChangeNotifier::new();
        let pool = apply_internal_pool_policy(pool_options)
            .connect_with(options)
            .await?;

        Ok(Self {
            pool,
            change_notifier,
        })
    }

    pub async fn connect_memory_plain() -> Result<Self, sqlx::Error> {
        let options =
            apply_internal_connect_policy(SqliteConnectOptions::from_str("sqlite::memory:")?)
                .pragma("foreign_keys", "ON");
        let (change_notifier, pool_options) = anlg_db_change::ChangeNotifier::new();
        let pool = apply_internal_pool_policy(pool_options)
            .max_connections(1)
            .connect_with(options)
            .await?;

        Ok(Self {
            pool,
            change_notifier,
        })
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}

async fn connect_with_options(
    options: &DbOpenOptions<'_>,
    pool_options: SqlitePoolOptions,
    change_notifier: anlg_db_change::ChangeNotifier,
) -> Result<Db, DbOpenError> {
    let mut connect_options = match options.storage {
        DbStorage::Local(path) => {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            apply_internal_connect_policy(SqliteConnectOptions::new())
                .filename(path)
                .create_if_missing(true)
        }
        DbStorage::Memory => {
            apply_internal_connect_policy(SqliteConnectOptions::from_str("sqlite::memory:")?)
        }
    };

    if options.journal_mode_wal {
        connect_options = connect_options.pragma("journal_mode", "WAL");
    }
    if options.foreign_keys {
        connect_options = connect_options.pragma("foreign_keys", "ON");
    }

    let mut pool_options = apply_internal_pool_policy(pool_options);
    match options.storage {
        DbStorage::Memory => {
            pool_options = pool_options.max_connections(1);
        }
        DbStorage::Local(_) => {
            if let Some(max) = options.max_connections {
                pool_options = pool_options.max_connections(max);
            }
        }
    };
    let pool = pool_options.connect_with(connect_options).await?;

    Ok(Db {
        pool,
        change_notifier,
    })
}

fn apply_internal_connect_policy(connect_options: SqliteConnectOptions) -> SqliteConnectOptions {
    connect_options.busy_timeout(SQLITE_BUSY_TIMEOUT)
}

fn apply_internal_pool_policy(pool_options: SqlitePoolOptions) -> SqlitePoolOptions {
    pool_options.after_release(|connection, _| {
        Box::pin(async move {
            if !connection.is_in_transaction() {
                return Ok(true);
            }

            tracing::warn!("sqlite_connection_returned_in_transaction");
            if let Err(error) = connection.ping().await {
                tracing::error!(%error, "sqlite_transaction_repair_failed");
                return Ok(false);
            }

            if connection.is_in_transaction() {
                tracing::error!("sqlite_connection_rejected_in_transaction");
                return Ok(false);
            }

            tracing::info!("sqlite_transaction_repaired_before_pool_return");
            Ok(true)
        })
    })
}

#[cfg(test)]
mod tests;
