use std::ffi::OsString;
use std::path::Path;
use std::path::PathBuf;

/// Where a download is written before it is verified and moved into place.
/// The name stays the same across attempts, so a download that failed part
/// way resumes from what it already wrote.
pub(crate) fn part_path(destination: &Path) -> PathBuf {
    let mut path = destination.to_path_buf();
    match destination.file_name() {
        Some(file_name) => {
            let mut name = OsString::from(file_name);
            name.push(".part");
            path.set_file_name(name);
        }
        None => path.push("download.part"),
    }
    path
}

/// Free space on the volume that holds `path`, or the nearest existing
/// directory above it.
pub(crate) fn available_space(path: &Path) -> Option<u64> {
    let existing = path.ancestors().find(|dir| dir.exists())?;
    let canonical = existing.canonicalize().ok()?;
    let disks = sysinfo::Disks::new_with_refreshed_list();
    disks
        .list()
        .iter()
        .filter(|disk| {
            disk.mount_point()
                .canonicalize()
                .is_ok_and(|mount| canonical.starts_with(mount))
        })
        .max_by_key(|disk| disk.mount_point().components().count())
        .map(|disk| disk.available_space())
}

/// Deletes the `.part` files directly in `dir` that nothing has written to
/// for `older_than`: downloads that failed and were never resumed. Returns
/// how many it deleted.
pub fn remove_stale_parts(dir: &Path, older_than: std::time::Duration) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let now = std::time::SystemTime::now();
    entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "part"))
        .filter(|entry| {
            entry
                .metadata()
                .ok()
                .filter(|meta| meta.is_file())
                .and_then(|meta| meta.modified().ok())
                .and_then(|modified| now.duration_since(modified).ok())
                .is_some_and(|age| age >= older_than)
        })
        .filter(|entry| std::fs::remove_file(entry.path()).is_ok())
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    // A multi-gigabyte download that failed and was never retried must not
    // sit on disk forever, but one still in use must stay.
    #[test]
    fn only_part_files_left_untouched_for_a_week_are_removed() {
        let dir = tempfile::tempdir().unwrap();
        let week = Duration::from_secs(7 * 24 * 60 * 60);
        let age = |name: &str, old: bool| {
            let path = dir.path().join(name);
            let file = std::fs::File::create(&path).unwrap();
            if old {
                file.set_modified(SystemTime::now() - week - Duration::from_secs(3600))
                    .unwrap();
            }
            path
        };
        let stale = age("Qwen3-4B-Q4_K_M.gguf.part", true);
        let recent = age("Qwen3-8B-Q4_K_M.gguf.part", false);
        let model = age("granite-4.0-micro-Q4_K_M.gguf", true);

        assert_eq!(remove_stale_parts(dir.path(), week), 1);
        assert!(!stale.exists());
        assert!(recent.exists() && model.exists());
    }
}
