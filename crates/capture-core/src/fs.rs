//! Private folders and atomic writes.

use std::io::Write;
use std::path::Path;

/// Creates `dir` (and its parents) and makes it readable by this user only.
pub fn ensure_private_dir(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Writes `bytes` to a temporary file next to `path`, then renames it over
/// `path`, so a reader sees the old file or the new one, never half of one.
/// `private` makes the file readable by this user only (0600).
pub fn write_atomic(path: &Path, bytes: &[u8], private: bool) -> std::io::Result<()> {
    let temp = temp_beside(path);
    let written = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        if private {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        #[cfg(not(unix))]
        let _ = private;
        let mut file = options.open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, path)
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    written
}

/// A hidden path next to `path` for a file being written.
fn temp_beside(path: &Path) -> std::path::PathBuf {
    let dir = path
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    dir.join(format!(".{name}.{}.tmp", uuid::Uuid::new_v4().simple()))
}

/// Writes `bytes` to `path` only when no file is there yet, atomically:
/// a reader, or another process doing the same, sees no file or the whole
/// one. False when one was already there, which is left as it is.
pub fn write_new_atomic(path: &Path, bytes: &[u8], private: bool) -> std::io::Result<bool> {
    let temp = temp_beside(path);
    write_atomic(&temp, bytes, private)?;
    let linked = std::fs::hard_link(&temp, path);
    let _ = std::fs::remove_file(&temp);
    match linked {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(error) => Err(error),
    }
}

/// Copies `from` to `to` through a hidden file next to `to`, flushed to disk
/// before it is renamed into place.
pub fn copy_atomic(from: &Path, to: &Path) -> std::io::Result<()> {
    let temp = temp_beside(to);
    let copied = (|| {
        std::fs::copy(from, &temp)?;
        std::fs::File::open(&temp)?.sync_all()?;
        std::fs::rename(&temp, to)
    })();
    if copied.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    copied
}

/// Renames `from` to `to`; across volumes, copies atomically and then
/// deletes `from`.
pub fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    copy_atomic(from, to)?;
    std::fs::remove_file(from)
}

/// Creates `dir` when missing and proves a file can be written in it.
pub fn ensure_writable(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let probe = dir.join(format!(".librelog-write-{}", uuid::Uuid::new_v4().simple()));
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)?;
    std::fs::remove_file(&probe)
}

/// Whether `a` and `b` name one file, however they are spelled (case on a
/// case-insensitive volume, a symlinked folder, `/var` and `/private/var`).
pub fn same_file(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let (Ok(a), Ok(b)) = (std::fs::metadata(a), std::fs::metadata(b)) {
            return a.dev() == b.dev() && a.ino() == b.ino();
        }
    }
    let canonical = |path: &Path| {
        path.canonicalize().ok().or_else(|| {
            let parent = path.parent()?.canonicalize().ok()?;
            Some(parent.join(path.file_name()?))
        })
    };
    match (canonical(a), canonical(b)) {
        (Some(a), Some(b)) => a == b,
        _ => a == b,
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn private_folders_and_files_are_this_users_only() {
        use std::os::unix::fs::PermissionsExt;
        let parent = tempfile::tempdir().unwrap();
        let dir = parent.path().join("captures/files");
        ensure_private_dir(&dir).unwrap();
        let file = dir.join("index.json");
        write_atomic(&file, b"{}", true).unwrap();
        write_atomic(&file, b"[]", true).unwrap();
        let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!((mode(&dir), mode(&file)), (0o700, 0o600));
        assert_eq!(std::fs::read(&file).unwrap(), b"[]");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
    }

    #[test]
    fn a_new_file_is_never_written_over_one_already_there() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backup.plist");
        assert!(write_new_atomic(&path, b"first", true).unwrap());
        assert!(!write_new_atomic(&path, b"second", true).unwrap());
        assert_eq!(std::fs::read(&path).unwrap(), b"first");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
