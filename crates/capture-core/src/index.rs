//! The index of recent captures (`index.json`): newest first, at most
//! [`MAX_ENTRIES`]. Entries whose file is gone are dropped when it is read;
//! a dropped entry's thumbnail goes with it, and so does its file when that
//! is in the library. Files in the user's folders are never deleted here.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::Layout;
use crate::fs::write_atomic;

pub const MAX_ENTRIES: usize = 200;
const VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Screenshot,
    Video,
    Gif,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Screenshot => "screenshot",
            Self::Video => "video",
            Self::Gif => "gif",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    /// `cap-<created_ms>-<4 hex>`.
    pub id: String,
    pub kind: Kind,
    pub path: String,
    pub thumbnail_path: String,
    pub created_ms: i64,
    /// Pixels.
    pub width: u32,
    pub height: u32,
    /// Pixels a point of the display it was taken on.
    pub scale: f64,
    /// 0 for screenshots.
    pub duration_ms: u64,
    pub bytes: u64,
    /// The file is in the library folder, not saved to a folder of the
    /// user's.
    pub in_library: bool,
}

#[derive(Serialize, Deserialize)]
struct File {
    version: u32,
    entries: Vec<Entry>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Index {
    entries: Vec<Entry>,
}

impl Index {
    /// Reads the index. A missing one is empty; one that cannot be read as an
    /// index is renamed aside (the second value says where) and an empty one
    /// takes its place, so it is never silently overwritten.
    pub fn load(path: &Path) -> std::io::Result<(Self, Option<PathBuf>)> {
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok((Self::default(), None));
            }
            Err(error) => return Err(error),
        };
        match serde_json::from_slice::<File>(&bytes) {
            Ok(file) => Ok((
                Self {
                    entries: file.entries,
                },
                None,
            )),
            Err(_) => {
                let millis = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_or(0, |since| since.as_millis());
                let aside = path.with_file_name(format!("index.corrupt-{millis}.json"));
                std::fs::rename(path, &aside)?;
                Ok((Self::default(), Some(aside)))
            }
        }
    }

    /// Writes it atomically, readable by this user only.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let file = File {
            version: VERSION,
            entries: self.entries.clone(),
        };
        let json = serde_json::to_vec_pretty(&file).map_err(std::io::Error::other)?;
        write_atomic(path, &json, true)
    }

    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    pub fn get(&self, id: &str) -> Option<&Entry> {
        self.entries.iter().find(|entry| entry.id == id)
    }

    /// Puts `entry` first (replacing one with its id) and returns the oldest
    /// ones past [`MAX_ENTRIES`].
    pub fn add(&mut self, entry: Entry) -> Vec<Entry> {
        self.entries.retain(|known| known.id != entry.id);
        self.entries.insert(0, entry);
        self.entries.split_off(self.entries.len().min(MAX_ENTRIES))
    }

    /// Replaces the entry with `entry`'s id, keeping its place. False when
    /// there is none.
    pub fn update(&mut self, entry: Entry) -> bool {
        match self.entries.iter_mut().find(|known| known.id == entry.id) {
            Some(known) => {
                *known = entry;
                true
            }
            None => false,
        }
    }

    pub fn remove(&mut self, id: &str) -> Option<Entry> {
        let at = self.entries.iter().position(|entry| entry.id == id)?;
        Some(self.entries.remove(at))
    }

    /// Drops the entries whose file `exists` says is gone, and the oldest
    /// past [`MAX_ENTRIES`]; returns them.
    pub fn prune(&mut self, exists: impl Fn(&Path) -> bool) -> Vec<Entry> {
        let (kept, mut dropped): (Vec<_>, Vec<_>) = std::mem::take(&mut self.entries)
            .into_iter()
            .partition(|entry| exists(Path::new(&entry.path)));
        self.entries = kept;
        dropped.extend(self.entries.split_off(self.entries.len().min(MAX_ENTRIES)));
        dropped
    }
}

/// Deletes what dropped entries leave behind in Capture's own folders: their
/// thumbnails, and their files when those are in the library.
pub fn forget(layout: &Layout, dropped: &[Entry]) {
    for entry in dropped {
        let thumbnail = Path::new(&entry.thumbnail_path);
        if layout.in_thumbs(thumbnail) {
            let _ = std::fs::remove_file(thumbnail);
        }
        let file = Path::new(&entry.path);
        if entry.in_library && layout.in_library(file) {
            let _ = std::fs::remove_file(file);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(layout: &Layout, n: i64, in_library: bool, folder: &Path) -> Entry {
        let id = format!("cap-{n}-0000");
        let path = if in_library {
            layout.files_dir().join(format!("{n}.png"))
        } else {
            folder.join(format!("{n}.png"))
        };
        std::fs::write(&path, b"png").unwrap();
        let thumbnail = layout.thumbnail_path(&id);
        std::fs::write(&thumbnail, b"png").unwrap();
        Entry {
            id,
            kind: Kind::Screenshot,
            path: path.to_string_lossy().into_owned(),
            thumbnail_path: thumbnail.to_string_lossy().into_owned(),
            created_ms: n,
            width: 10,
            height: 10,
            scale: 2.0,
            duration_ms: 0,
            bytes: 3,
            in_library,
        }
    }

    #[test]
    fn pruning_drops_missing_files_and_the_oldest_past_the_cap_but_never_deletes_user_files() {
        let dir = tempfile::tempdir().unwrap();
        let layout = Layout::new(dir.path().join("captures"));
        layout.ensure().unwrap();
        let user = dir.path().join("Downloads");
        std::fs::create_dir_all(&user).unwrap();

        let mut index = Index::default();
        let oldest_user = entry(&layout, 0, false, &user);
        let oldest_library = entry(&layout, 1, true, &user);
        index.add(oldest_user.clone());
        index.add(oldest_library.clone());
        for n in 2..MAX_ENTRIES as i64 {
            index.add(entry(&layout, n, n % 2 == 0, &user));
        }
        let gone = index.entries()[5].clone();
        std::fs::remove_file(&gone.path).unwrap();
        // Two more push the two oldest out.
        let overflow = [
            entry(&layout, 1000, true, &user),
            entry(&layout, 1001, true, &user),
        ];
        let mut dropped = Vec::new();
        for entry in overflow {
            dropped.extend(index.add(entry));
        }
        dropped.extend(index.prune(|path| path.exists()));
        forget(&layout, &dropped);

        let ids: Vec<_> = dropped.iter().map(|entry| entry.id.as_str()).collect();
        assert_eq!(ids, [oldest_user.id.as_str(), &oldest_library.id, &gone.id]);
        assert_eq!(index.entries().len(), MAX_ENTRIES - 1);
        assert_eq!(index.entries()[0].created_ms, 1001);
        assert!(Path::new(&oldest_user.path).exists());
        assert!(!Path::new(&oldest_library.path).exists());
        assert!(!Path::new(&oldest_user.thumbnail_path).exists());
        assert!(!Path::new(&gone.thumbnail_path).exists());
    }

    #[test]
    fn a_corrupt_index_is_set_aside_not_overwritten_and_a_saved_one_reads_back() {
        let dir = tempfile::tempdir().unwrap();
        let layout = Layout::new(dir.path().to_path_buf());
        layout.ensure().unwrap();
        let path = layout.index_path();
        assert_eq!(Index::load(&path).unwrap(), (Index::default(), None));

        std::fs::write(&path, b"{ not json").unwrap();
        let (index, aside) = Index::load(&path).unwrap();
        assert!(index.entries().is_empty());
        let aside = aside.unwrap();
        assert_eq!(std::fs::read(&aside).unwrap(), b"{ not json");
        assert!(!path.exists());

        let mut index = Index::default();
        index.add(entry(&layout, 7, true, dir.path()));
        index.save(&path).unwrap();
        assert_eq!(Index::load(&path).unwrap(), (index, None));
    }
}
