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

/// Where [`move_to_free_name`] put a file.
#[derive(Debug)]
pub struct Moved {
    pub path: std::path::PathBuf,
    /// The file was saved, but its source could not be removed.
    pub leftover: Option<std::io::Error>,
}

/// Moves `from` into `dir` under the first of `name(1)`, `name(2)`… that no
/// file holds, never replacing one, even when another process names a file
/// the same moment. On one volume the file is hard-linked to its name (which
/// fails when the name is taken) and then unlinked; across volumes, or where
/// links are not supported, the name is created exclusively and the bytes
/// copied into it and flushed before the source is removed.
pub fn move_to_free_name(
    from: &Path,
    dir: &Path,
    name: impl Fn(u32) -> String,
) -> std::io::Result<Moved> {
    use std::io::ErrorKind::AlreadyExists;
    let mut link = true;
    for copy in 1..10_000 {
        let target = dir.join(name(copy));
        if link {
            match std::fs::hard_link(from, &target) {
                Ok(()) => {
                    let leftover = std::fs::remove_file(from).err();
                    return Ok(Moved {
                        path: target,
                        leftover,
                    });
                }
                Err(error) if error.kind() == AlreadyExists => continue,
                // Another volume, or links not supported there.
                Err(_) => link = false,
            }
        }
        let mut file = match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
        {
            Ok(file) => file,
            Err(error) if error.kind() == AlreadyExists => continue,
            Err(error) => return Err(error),
        };
        let copied = std::fs::File::open(from)
            .and_then(|mut source| std::io::copy(&mut source, &mut file))
            .and_then(|_| file.sync_all());
        if let Err(error) = copied {
            drop(file);
            let _ = std::fs::remove_file(&target);
            return Err(error);
        }
        let leftover = std::fs::remove_file(from).err();
        return Ok(Moved {
            path: target,
            leftover,
        });
    }
    Err(std::io::Error::new(AlreadyExists, "no free file name"))
}

/// Holds an exclusive lock on `path` (created when missing) until the file
/// is dropped: serializes work between processes sharing a folder, such as
/// the stable and Nightly apps.
pub fn lock_exclusive(path: &Path) -> std::io::Result<std::fs::File> {
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)?;
    file.lock()?;
    Ok(file)
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

    #[test]
    fn a_capture_never_replaces_a_file_that_took_its_name() {
        let dir = tempfile::tempdir().unwrap();
        let name = |copy: u32| format!("shot {copy}.png");
        std::fs::write(dir.path().join(name(1)), b"theirs").unwrap();
        let source = dir.path().join(".capture-1.png");
        std::fs::write(&source, b"mine").unwrap();
        let moved = move_to_free_name(&source, dir.path(), name).unwrap();
        assert_eq!(moved.path, dir.path().join(name(2)));
        assert!(moved.leftover.is_none() && !source.exists());
        assert_eq!(std::fs::read(dir.path().join(name(1))).unwrap(), b"theirs");
        assert_eq!(std::fs::read(&moved.path).unwrap(), b"mine");
    }
}
