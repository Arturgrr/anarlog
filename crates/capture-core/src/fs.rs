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
    let dir = path
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let temp = dir.join(format!(".{name}.{}.tmp", uuid::Uuid::new_v4().simple()));
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
}
