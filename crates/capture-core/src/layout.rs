//! Where captures live: `<root>/files/` (the library, for captures not saved
//! to a folder), `<root>/thumbs/<id>.png`, `<root>/index.json` and the
//! backup of the macOS screenshot shortcuts. `<root>` is
//! `<app data dir>/captures`.

use std::path::{Path, PathBuf};

use crate::fs::ensure_private_dir;

pub const INDEX_FILE: &str = "index.json";
pub const SHORTCUTS_BACKUP_FILE: &str = "system-shortcuts-backup.plist";
pub const THUMBNAIL_LONG_EDGE: u32 = 480;

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
}
