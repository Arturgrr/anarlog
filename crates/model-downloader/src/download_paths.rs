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
