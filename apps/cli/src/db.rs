use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use crate::{Args, Error, Result};

pub async fn open(args: &Args) -> Result<anlg_db_core::Db> {
    let path = resolve_path(args)?;
    if !path.is_file() {
        return Err(Error::DatabaseNotFound(path));
    }

    anlg_db_core::Db::connect_local_read_only(&path)
        .await
        .map_err(|error| Error::operation("open database", error.to_string()))
}

pub async fn open_write(args: &Args) -> Result<anlg_db_core::Db> {
    let path = resolve_path(args)?;
    if !path.is_file() {
        return Err(Error::DatabaseNotFound(path));
    }

    let db = anlg_db_core::Db::connect_local_read_write(&path)
        .await
        .map_err(|error| Error::operation("open database for writes", error.to_string()))?;
    // Writes to a database last opened by a build with sync would hit triggers
    // that call the removed sqlite-sync extension.
    anlg_db_app::detach_legacy_cloudsync(db.pool())
        .await
        .map_err(|error| Error::operation("open database for writes", error.to_string()))?;
    Ok(db)
}

pub(crate) fn resolve_path(args: &Args) -> Result<PathBuf> {
    if let Some(path) = &args.db_path {
        return Ok(path.clone());
    }
    if let Some(base) = &args.base {
        return Ok(base.join("app.db"));
    }

    let data_dir = dirs::data_dir().ok_or_else(|| {
        Error::operation("resolve database path", "data directory is unavailable")
    })?;
    Ok(resolve_default_path(&data_dir))
}

fn resolve_default_path(data_dir: &Path) -> PathBuf {
    let command_name = std::env::args_os()
        .next()
        .and_then(|path| Path::new(&path).file_name().map(|name| name.to_owned()));
    resolve_default_path_for_command(data_dir, command_name.as_deref())
}

fn resolve_default_path_for_command(data_dir: &Path, command_name: Option<&OsStr>) -> PathBuf {
    let command_name = command_name
        .and_then(OsStr::to_str)
        .and_then(|name| Path::new(name).file_stem())
        .and_then(OsStr::to_str);
    // `librelog-nightly` falls through: the Nightly desktop app opens the same
    // database as stable.
    let folder = match command_name {
        Some("librelog-dev") => "com.arturgrr.librelog.dev",
        Some("librelog-staging") => "com.arturgrr.librelog.staging",
        _ => "librelog",
    };
    data_dir.join(folder).join("app.db")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_commands_target_their_channel_database() {
        let dir = tempfile::tempdir().unwrap();
        let stable = dir.path().join("librelog/app.db");

        for command in [
            "librelog",
            "librelog.exe",
            "librelog-nightly",
            "librelog-nightly.exe",
        ] {
            assert_eq!(
                resolve_default_path_for_command(dir.path(), Some(OsStr::new(command))),
                stable
            );
        }
        assert_eq!(
            resolve_default_path_for_command(dir.path(), Some(OsStr::new("librelog-dev"))),
            dir.path().join("com.arturgrr.librelog.dev/app.db")
        );
        assert_eq!(
            resolve_default_path_for_command(dir.path(), Some(OsStr::new("librelog-staging"))),
            dir.path().join("com.arturgrr.librelog.staging/app.db")
        );
        assert_eq!(
            resolve_default_path_for_command(dir.path(), Some(OsStr::new("librelog-dev.exe"))),
            dir.path().join("com.arturgrr.librelog.dev/app.db")
        );
        assert_eq!(
            resolve_default_path_for_command(dir.path(), Some(OsStr::new("librelog-staging.exe"))),
            dir.path().join("com.arturgrr.librelog.staging/app.db")
        );
    }
}
