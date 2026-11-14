//! Where captures live: `<root>/files/` (the library, for captures not saved
//! to a folder), `<root>/thumbs/<id>.png`, `<root>/index.json` and the
//! backup of the macOS screenshot shortcuts. `<root>` is
//! `<app data dir>/captures`.

use std::path::{Path, PathBuf};

use crate::fs::ensure_private_dir;

pub const INDEX_FILE: &str = "index.json";
pub const SHORTCUTS_BACKUP_FILE: &str = "system-shortcuts-backup.plist";
pub const THUMBNAIL_LONG_EDGE: u32 = 480;
/// What the native layer writes into before a capture gets its name.
const TEMP_PREFIXES: [&str; 2] = [".capture-", ".recording-"];

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PathError {
    #[error("The folder must be an absolute path: {0}")]
    NotAbsolute(String),
    #[error("The Downloads folder could not be found.")]
    NoDownloads,
}

#[derive(Clone, Debug)]
pub struct Layout {
    root: PathBuf,
}

impl Layout {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn files_dir(&self) -> PathBuf {
        self.root.join("files")
    }

    pub fn thumbs_dir(&self) -> PathBuf {
        self.root.join("thumbs")
    }

    pub fn index_path(&self) -> PathBuf {
        self.root.join(INDEX_FILE)
    }

    pub fn shortcuts_backup_path(&self) -> PathBuf {
        self.root.join(SHORTCUTS_BACKUP_FILE)
    }

    /// Only for ids this crate made ([`new_id`]); never for one from outside.
    pub fn thumbnail_path(&self, id: &str) -> PathBuf {
        self.thumbs_dir().join(format!("{id}.png"))
    }

    /// A hidden file in the library for a capture being written:
    /// `.capture-<random>.<extension>`.
    pub fn temp_path(&self, extension: &str) -> PathBuf {
        self.files_dir().join(format!(
            "{}{}.{extension}",
            TEMP_PREFIXES[0],
            uuid::Uuid::new_v4().simple()
        ))
    }

    /// Hidden capture files in the library last written more than
    /// `older_than` ago: what a quit or crash left. Movies with something in
    /// them are returned, to be recovered; the rest (empty files, partial
    /// GIFs, pictures never named) are deleted. Fresh ones may belong to a
    /// capture another copy of the app (stable or Nightly) is making.
    pub fn sweep_temps(&self, older_than: std::time::Duration) -> Vec<PathBuf> {
        let Ok(files) = std::fs::read_dir(self.files_dir()) else {
            return Vec::new();
        };
        let mut movies = Vec::new();
        for file in files.filter_map(Result::ok) {
            let name = file.file_name().to_string_lossy().into_owned();
            if !TEMP_PREFIXES.iter().any(|prefix| name.starts_with(prefix)) {
                continue;
            }
            let Ok(metadata) = file.metadata() else {
                continue;
            };
            let old = metadata
                .modified()
                .ok()
                .and_then(|modified| modified.elapsed().ok())
                .is_some_and(|age| age > older_than);
            if !old || !metadata.is_file() {
                continue;
            }
            if name.ends_with(".mp4") && metadata.len() > 0 {
                movies.push(file.path());
            } else {
                let _ = std::fs::remove_file(file.path());
            }
        }
        movies.sort();
        movies
    }

    /// Creates the folders, readable by this user only.
    pub fn ensure(&self) -> std::io::Result<()> {
        for dir in [self.root.clone(), self.files_dir(), self.thumbs_dir()] {
            ensure_private_dir(&dir)?;
        }
        Ok(())
    }

    /// Whether `path` is a file directly in the library folder, the only
    /// files Capture deletes on its own.
    pub fn in_library(&self, path: &Path) -> bool {
        path.parent() == Some(self.files_dir().as_path())
            && path
                .file_name()
                .is_some_and(|name| name != "." && name != "..")
    }

    pub fn in_thumbs(&self, path: &Path) -> bool {
        path.parent() == Some(self.thumbs_dir().as_path())
    }

    /// The folder a capture is written to: the library when `save_dir` is
    /// `None`, the user's Downloads when it is empty, else `save_dir`, which
    /// must be absolute. The flag tells whether it is the library.
    pub fn destination(
        &self,
        save_dir: Option<&str>,
        downloads: Option<&Path>,
    ) -> Result<(PathBuf, bool), PathError> {
        match save_dir {
            None => Ok((self.files_dir(), true)),
            Some(dir) => Ok((user_folder(Some(dir), downloads)?, false)),
        }
    }
}

/// The user's folder: `folder` when given and not empty (absolute only),
/// else Downloads.
pub fn user_folder(folder: Option<&str>, downloads: Option<&Path>) -> Result<PathBuf, PathError> {
    match folder.map(str::trim).filter(|folder| !folder.is_empty()) {
        Some(folder) => {
            let path = PathBuf::from(folder);
            if path.is_absolute() {
                Ok(path)
            } else {
                Err(PathError::NotAbsolute(folder.to_owned()))
            }
        }
        None => downloads
            .map(Path::to_path_buf)
            .ok_or(PathError::NoDownloads),
    }
}

/// Whether `id` is fit for a window label and a route:
/// `[A-Za-z0-9_-]{1,64}`, as every id [`new_id`] makes is.
pub fn is_capture_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

/// `cap-<created_ms>-<4 hex>`.
pub fn new_id(created_ms: i64) -> String {
    let random = uuid::Uuid::new_v4();
    let bytes = random.as_bytes();
    format!("cap-{created_ms}-{:02x}{:02x}", bytes[0], bytes[1])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn destinations_are_the_library_downloads_or_an_absolute_folder_only() {
        let layout = Layout::new(PathBuf::from("/data/captures"));
        let downloads = Path::new("/Users/me/Downloads");
        assert_eq!(
            layout.destination(None, Some(downloads)),
            Ok((PathBuf::from("/data/captures/files"), true))
        );
        assert_eq!(
            layout.destination(Some(""), Some(downloads)),
            Ok((downloads.to_path_buf(), false))
        );
        assert_eq!(
            layout.destination(Some("/Users/me/Shots"), None),
            Ok((PathBuf::from("/Users/me/Shots"), false))
        );
        assert_eq!(
            layout.destination(Some("../../etc"), Some(downloads)),
            Err(PathError::NotAbsolute("../../etc".into()))
        );
        assert_eq!(
            layout.destination(Some(" "), None),
            Err(PathError::NoDownloads)
        );
        assert!(layout.in_library(Path::new("/data/captures/files/a.png")));
        assert!(!layout.in_library(Path::new("/data/captures/files/x/a.png")));
        assert!(!layout.in_library(Path::new("/data/captures/index.json")));
    }

    #[test]
    fn only_plain_ids_name_a_capture_editor() {
        assert!(is_capture_id(&new_id(1_763_128_000_000)));
        for bad in ["", "../note", "cap 1", "cap/1", "cap-é", &"a".repeat(65)] {
            assert!(!is_capture_id(bad), "{bad}");
        }
    }

    #[test]
    fn old_hidden_movies_are_kept_for_recovery_and_other_leftovers_swept() {
        let dir = tempfile::tempdir().unwrap();
        let layout = Layout::new(dir.path().to_path_buf());
        layout.ensure().unwrap();
        let hours_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(3 * 3600);
        let movies = [
            layout.files_dir().join(".capture-a.mp4"),
            layout.files_dir().join(".recording-cap-1-0000.mp4"),
        ];
        let swept = [
            layout.temp_path("gif"),
            layout.files_dir().join(".capture-b.mp4"),
        ];
        let kept = [
            layout.temp_path("mp4"),
            layout
                .files_dir()
                .join("Librelog Recording 2026-11-14 at 14.03.22.mp4"),
        ];
        for path in movies.iter().chain(&kept) {
            std::fs::write(path, b"mp4").unwrap();
        }
        std::fs::write(&swept[0], b"GIF8").unwrap();
        std::fs::write(&swept[1], b"").unwrap();
        let make_old = |path: &PathBuf| {
            std::fs::File::options()
                .write(true)
                .open(path)
                .unwrap()
                .set_modified(hours_ago)
                .unwrap();
        };
        movies.iter().chain(&swept).for_each(make_old);
        make_old(&kept[1]);
        let found = layout.sweep_temps(std::time::Duration::from_secs(2 * 3600));
        assert_eq!(found, movies.to_vec());
        assert!(movies.iter().chain(&kept).all(|path| path.exists()));
        assert!(swept.iter().all(|path| !path.exists()));
    }
}
