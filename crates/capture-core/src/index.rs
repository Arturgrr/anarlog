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
    /// Fields a newer build wrote, kept as they were.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize)]
struct File<'a> {
    version: u32,
    entries: Vec<std::borrow::Cow<'a, serde_json::Value>>,
}

/// An entry this build reads, or one it cannot (from a newer build sharing
/// the folder), kept as it was and written back in its place.
#[derive(Clone, Debug, PartialEq)]
enum Item {
    Parsed(Entry),
    Raw(serde_json::Value),
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Index {
    items: Vec<Item>,
}

#[derive(Debug, Default, PartialEq)]
pub struct Loaded {
    pub index: Index,
    /// Where an unreadable index was renamed to.
    pub set_aside: Option<PathBuf>,
    /// Entries this build cannot read; they are kept as they are.
    pub skipped: usize,
}

/// A capture's file is gone: its folder can be read and says the file is
/// not there. Any other failure (an unplugged drive, a folder this app may
/// not read) is not proof, and the entry stays.
pub fn gone(path: &Path) -> bool {
    match std::fs::metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => path
            .parent()
            .is_some_and(|parent| std::fs::read_dir(parent).is_ok()),
        _ => false,
    }
}

impl Index {
    /// Reads the index. A missing one is empty; one that cannot be read as an
    /// index at all is renamed aside and an empty one takes its place, so it
    /// is never silently overwritten. Entries this build cannot read are
    /// counted and kept as they are.
    pub fn load(path: &Path) -> std::io::Result<Loaded> {
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Loaded::default());
            }
            Err(error) => return Err(error),
        };
        let entries = serde_json::from_slice::<serde_json::Value>(&bytes)
            .ok()
            .and_then(|mut file| match file.get_mut("entries")?.take() {
                serde_json::Value::Array(entries) => Some(entries),
                _ => None,
            });
        let Some(entries) = entries else {
            let millis = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |since| since.as_millis());
            let aside = path.with_file_name(format!("index.corrupt-{millis}.json"));
            std::fs::rename(path, &aside)?;
            return Ok(Loaded {
                set_aside: Some(aside),
                ..Loaded::default()
            });
        };
        let items: Vec<Item> = entries
            .into_iter()
            .map(
                |entry| match serde_json::from_value::<Entry>(entry.clone()) {
                    Ok(parsed) => Item::Parsed(parsed),
                    Err(_) => Item::Raw(entry),
                },
            )
            .collect();
        Ok(Loaded {
            skipped: items
                .iter()
                .filter(|item| matches!(item, Item::Raw(_)))
                .count(),
            index: Self { items },
            set_aside: None,
        })
    }

    /// Writes it atomically, readable by this user only.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        use std::borrow::Cow;
        let entries = self
            .items
            .iter()
            .map(|item| match item {
                Item::Parsed(entry) => serde_json::to_value(entry).map(Cow::Owned),
                Item::Raw(raw) => Ok(Cow::Borrowed(raw)),
            })
            .collect::<Result<Vec<_>, _>>()
            .map_err(std::io::Error::other)?;
        let file = File {
            version: VERSION,
            entries,
        };
        let json = serde_json::to_vec_pretty(&file).map_err(std::io::Error::other)?;
        write_atomic(path, &json, true)
    }

    /// The entries this build reads, newest first.
    pub fn entries(&self) -> impl Iterator<Item = &Entry> {
        self.items.iter().filter_map(|item| match item {
            Item::Parsed(entry) => Some(entry),
            Item::Raw(_) => None,
        })
    }

    pub fn get(&self, id: &str) -> Option<&Entry> {
        self.entries().find(|entry| entry.id == id)
    }

    fn position(&self, id: &str) -> Option<usize> {
        self.items
            .iter()
            .position(|item| matches!(item, Item::Parsed(entry) if entry.id == id))
    }

    /// Drops the oldest entries this build reads past [`MAX_ENTRIES`];
    /// returns them.
    fn cap(&mut self) -> Vec<Entry> {
        let mut seen = 0;
        let mut dropped = Vec::new();
        self.items.retain(|item| match item {
            Item::Parsed(entry) => {
                seen += 1;
                if seen > MAX_ENTRIES {
                    dropped.push(entry.clone());
                    false
                } else {
                    true
                }
            }
            Item::Raw(_) => true,
        });
        dropped
    }

    /// Puts `entry` first (replacing one with its id) and returns the oldest
    /// ones past [`MAX_ENTRIES`].
    pub fn add(&mut self, entry: Entry) -> Vec<Entry> {
        if let Some(at) = self.position(&entry.id) {
            self.items.remove(at);
        }
        self.items.insert(0, Item::Parsed(entry));
        self.cap()
    }

    /// Replaces the entry with `entry`'s id, keeping its place. False when
    /// there is none.
    pub fn update(&mut self, entry: Entry) -> bool {
        match self.position(&entry.id) {
            Some(at) => {
                self.items[at] = Item::Parsed(entry);
                true
            }
            None => false,
        }
    }

    pub fn remove(&mut self, id: &str) -> Option<Entry> {
        let at = self.position(id)?;
        match self.items.remove(at) {
            Item::Parsed(entry) => Some(entry),
            Item::Raw(_) => None,
        }
    }

    /// Drops the entries `keep` says no to, and the oldest past
    /// [`MAX_ENTRIES`]; returns them. Entries this build cannot read stay.
    pub fn prune(&mut self, keep: impl Fn(&Path) -> bool) -> Vec<Entry> {
        let mut dropped = Vec::new();
        self.items.retain(|item| match item {
            Item::Parsed(entry) if !keep(Path::new(&entry.path)) => {
                dropped.push(entry.clone());
                false
            }
            _ => true,
        });
        dropped.extend(self.cap());
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
            extra: Default::default(),
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
        let gone = index.entries().nth(5).unwrap().clone();
        std::fs::remove_file(&gone.path).unwrap();
        // A file on a drive that is not plugged in is not gone.
        let mut unplugged = index.entries().nth(6).unwrap().clone();
        unplugged.path = dir
            .path()
            .join("Volumes/USB/a.png")
            .to_string_lossy()
            .into_owned();
        index.update(unplugged.clone());
        // Nor one this app cannot look at: here its "folder" is a file.
        let mut unreadable = index.entries().nth(7).unwrap().clone();
        unreadable.path = Path::new(&oldest_user.path)
            .join("a.png")
            .to_string_lossy()
            .into_owned();
        index.update(unreadable.clone());
        // Two more push the two oldest out.
        let overflow = [
            entry(&layout, 1000, true, &user),
            entry(&layout, 1001, true, &user),
        ];
        let mut dropped = Vec::new();
        for entry in overflow {
            dropped.extend(index.add(entry));
        }
        dropped.extend(index.prune(|path| !super::gone(path)));
        forget(&layout, &dropped);

        let ids: Vec<_> = dropped.iter().map(|entry| entry.id.as_str()).collect();
        assert_eq!(ids, [oldest_user.id.as_str(), &oldest_library.id, &gone.id]);
        assert_eq!(index.entries().count(), MAX_ENTRIES - 1);
        assert_eq!(index.entries().next().unwrap().created_ms, 1001);
        assert!(index.get(&unplugged.id).is_some() && index.get(&unreadable.id).is_some());
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
        assert_eq!(Index::load(&path).unwrap(), Loaded::default());

        std::fs::write(&path, b"{ not json").unwrap();
        let loaded = Index::load(&path).unwrap();
        assert_eq!(loaded.index.entries().count(), 0);
        let aside = loaded.set_aside.unwrap();
        assert_eq!(std::fs::read(&aside).unwrap(), b"{ not json");
        assert!(!path.exists());

        let mut index = Index::default();
        index.add(entry(&layout, 7, true, dir.path()));
        index.save(&path).unwrap();
        assert_eq!(Index::load(&path).unwrap().index, index);

        // A newer build's entry and field survive this build's saves.
        let mut file: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        let newer = serde_json::json!({ "id": "cap-8-0000", "kind": "hologram" });
        let entries = file["entries"].as_array_mut().unwrap();
        entries[0]["annotations"] = serde_json::json!(3);
        entries.push(newer.clone());
        std::fs::write(&path, serde_json::to_vec(&file).unwrap()).unwrap();
        let mut loaded = Index::load(&path).unwrap();
        assert_eq!((loaded.skipped, loaded.set_aside), (1, None));
        loaded.index.add(entry(&layout, 9, true, dir.path()));
        loaded.index.save(&path).unwrap();
        let saved: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["entries"][1]["annotations"], 3);
        assert_eq!(saved["entries"][2], newer);
    }
}
