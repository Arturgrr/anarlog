//! The captures the user has: the index, and what the frontend and the
//! cards do with an entry. Ids from outside are only ever looked up in the
//! index, never joined into a path. These block; run them on a worker.

use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anlg_capture_core::fs::{
    copy_atomic, lock_exclusive, move_to_free_name, same_file, write_atomic,
};
use anlg_capture_core::layout::{THUMBNAIL_LONG_EDGE, new_id, user_folder};
use anlg_capture_core::names::FileName;
use anlg_capture_core::{Entry, ImageFormat, Index, Kind, Stamp, index, names};
use base64::Engine;

use crate::Error;
use crate::session::{Session, now_ms};
use crate::types::CaptureEntry;

/// The largest edited picture `save_edited` takes, decoded.
const MAX_EDITED_BYTES: usize = 80 * 1024 * 1024;
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
const JPEG_QUALITY: u8 = 90;
const INDEX_LOCK: &str = "index.lock";

impl Session {
    /// Reads the index (dropping entries whose file is gone), lets `change`
    /// work on it and writes it back when it changed.
    pub(crate) fn with_index<T>(
        &self,
        change: impl FnOnce(&mut Index) -> Result<T, Error>,
    ) -> Result<T, Error> {
        if !self.native.available() {
            return Err(Error::Unavailable);
        }
        let _guard = self.index.lock().unwrap_or_else(|e| e.into_inner());
        self.layout.ensure()?;
        // The other app sharing the folder (stable or Nightly) waits too.
        let _shared = lock_exclusive(&self.layout.root().join(INDEX_LOCK))?;
        let path = self.layout.index_path();
        let loaded = Index::load(&path)?;
        if let Some(aside) = loaded.set_aside {
            tracing::warn!(aside = %aside.display(), "capture index was unreadable; set aside");
        }
        if loaded.skipped > 0 {
            tracing::warn!(
                skipped = loaded.skipped,
                "capture index entries could not be read"
            );
        }
        let mut index = loaded.index;
        let before = index.clone();
        let dropped = index.prune(|path| !index::gone(path));
        self.forget(&dropped);
        let result = change(&mut index);
        if index != before {
            index.save(&path)?;
        }
        result
    }

    fn entry(&self, id: &str) -> Result<Entry, Error> {
        self.with_index(|index| index.get(id).cloned().ok_or(Error::UnknownCapture))
    }

    pub(crate) fn add_entry(&self, entry: Entry) -> Result<(), Error> {
        let dropped = self.with_index(|index| Ok(index.add(entry)))?;
        self.forget(&dropped);
        Ok(())
    }

    pub fn list_captures(&self) -> Result<Vec<CaptureEntry>, Error> {
        if !self.native.available() {
            return Ok(Vec::new());
        }
        self.with_index(|index| Ok(index.entries().cloned().map(Into::into).collect()))
    }

    pub(crate) fn copy_entry(&self, entry: &Entry) -> Result<(), Error> {
        let json = serde_json::json!({ "path": entry.path, "kind": entry.kind.as_str() });
        self.native.copy(&json.to_string()).map_err(Error::from)
    }

    pub fn copy_capture(&self, id: &str) -> Result<(), Error> {
        self.copy_entry(&self.entry(id)?)
    }

    /// Removes the entry and its thumbnail. A file in the library is
    /// deleted; one in the user's folder goes to the Trash on macOS and
    /// stays where it is elsewhere.
    pub fn delete_capture(&self, id: &str) -> Result<(), Error> {
        let entry = self.with_index(|index| index.remove(id).ok_or(Error::UnknownCapture))?;
        self.close_card(&entry.id);
        let thumbnail = Path::new(&entry.thumbnail_path);
        if self.layout.in_thumbs(thumbnail) {
            let _ = std::fs::remove_file(thumbnail);
        }
        let file = Path::new(&entry.path);
        if entry.in_library && self.layout.in_library(file) {
            match std::fs::remove_file(file) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                    return Err(error.into());
                }
                _ => return Ok(()),
            }
        }
        if file.exists() {
            match self.native.trash(file) {
                Ok(()) => {}
                Err(error) if error.code == anlg_annotate_macos::codes::UNSUPPORTED => {
                    tracing::info!("capture deleted from the list; its file stays in place");
                }
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    }

    /// Copies the capture's file to `dest`, an absolute file path, through a
    /// hidden file renamed into place. The entry stays as it is; `dest` that
    /// is the capture's own file, however spelled, is left alone.
    pub fn save_capture_as(&self, id: &str, dest: &str) -> Result<CaptureEntry, Error> {
        let dest = PathBuf::from(dest);
        if !dest.is_absolute() || dest.file_name().is_none() || dest.is_dir() {
            return Err(Error::BadDestination);
        }
        let entry = self.entry(id)?;
        if !same_file(Path::new(&entry.path), &dest) {
            copy_atomic(Path::new(&entry.path), &dest)?;
        }
        Ok(entry.into())
    }

    /// Writes an edited screenshot (a base64 PNG): over the capture's file
    /// when `replace` (re-encoded as JPEG when the file is one), else as a
    /// new capture beside it. Its thumbnail, size and bytes follow.
    pub fn save_edited(
        self: &Arc<Self>,
        id: &str,
        png_base64: &str,
        replace: bool,
        copy: bool,
    ) -> Result<CaptureEntry, Error> {
        let image = decode_png(png_base64)?;
        let entry = self.entry(id)?;
        if entry.kind != Kind::Screenshot {
            return Err(Error::NotAScreenshot);
        }
        let format = ImageFormat::of(Path::new(&entry.path));
        let bytes = match format {
            ImageFormat::Png => image.png,
            ImageFormat::Jpeg => encode_jpeg(&image.picture)?,
        };
        let (path, mut saved) = if replace {
            (PathBuf::from(&entry.path), entry.clone())
        } else {
            let dir = Path::new(&entry.path)
                .parent()
                .ok_or(Error::UnknownCapture)?
                .to_path_buf();
            let created_ms = now_ms();
            // Written beside it, then named exclusively.
            let temp = dir.join(format!(
                ".capture-{}.{}",
                new_id(created_ms),
                format.extension()
            ));
            write_atomic(&temp, &bytes, false)?;
            let name = FileName::screenshot(Stamp::local(created_ms), format);
            let moved =
                move_to_free_name(&temp, &dir, |copy| name.nth(copy)).inspect_err(|_| {
                    let _ = std::fs::remove_file(&temp);
                })?;
            let path = moved.path;
            let saved = Entry {
                thumbnail_path: String::new(),
                created_ms,
                in_library: entry.in_library && self.layout.in_library(&path),
                path: path.to_string_lossy().into_owned(),
                id: new_id(created_ms),
                ..entry.clone()
            };
            (path, saved)
        };
        if replace {
            write_atomic(&path, &bytes, false)?;
        }
        let thumbnail = self.layout.thumbnail_path(&saved.id);
        saved.thumbnail_path = match write_thumbnail(&image.picture, &thumbnail) {
            Ok(()) => thumbnail.to_string_lossy().into_owned(),
            Err(error) => {
                tracing::warn!(%error, "capture thumbnail");
                String::new()
            }
        };
        saved.width = image.picture.width();
        saved.height = image.picture.height();
        saved.bytes = bytes.len() as u64;
        if replace {
            let updated = saved.clone();
            self.with_index(|index| {
                if index.update(updated.clone()) {
                    Ok(())
                } else {
                    index.add(updated);
                    Ok(())
                }
            })?;
        } else {
            let mut cards = self.lock_cards();
            if let Some(meta) = cards.meta(&entry.id).cloned() {
                cards.remember(saved.id.clone(), meta);
            }
            drop(cards);
            self.add_entry(saved.clone())?;
        }
        if copy && let Err(error) = self.copy_entry(&saved) {
            (self.emit)(crate::CaptureEvent::Failed {
                message: error.to_string(),
            });
        }
        Ok(saved.into())
    }

    /// The capture whose file `path` is, however spelled.
    pub(crate) fn entry_at(&self, path: &Path) -> Result<Option<Entry>, Error> {
        if !self.native.available() {
            return Ok(None);
        }
        self.with_index(|index| {
            Ok(index
                .entries()
                .find(|entry| same_file(Path::new(&entry.path), path))
                .cloned())
        })
    }

    pub fn show_card(self: &Arc<Self>, id: &str) -> Result<(), Error> {
        let entry = self.entry(id)?;
        self.show_entry_card(&entry)
    }

    /// A card's Save: a capture still in the library moves to the user's
    /// folder (the one its request named, or Downloads); a saved one is
    /// shown in Finder.
    pub(crate) fn card_save(self: &Arc<Self>, id: &str) -> Result<(), Error> {
        let entry = self.entry(id)?;
        let file = PathBuf::from(&entry.path);
        if !entry.in_library {
            return self.native.reveal(&file).map_err(Error::from);
        }
        let folder = self
            .lock_cards()
            .meta(id)
            .and_then(|meta| meta.folder.clone());
        let folder = user_folder(folder.as_deref(), self.downloads.as_deref())?;
        std::fs::create_dir_all(&folder)?;
        let name = file
            .file_name()
            .ok_or(Error::UnknownCapture)?
            .to_string_lossy()
            .into_owned();
        // Moved under the index's lock, which would otherwise drop the
        // entry of a file it no longer finds.
        let moved = self.with_index(|index| {
            let target = move_to_free_name(&file, &folder, |copy| names::nth_like(&name, copy))?;
            if let Some(leftover) = target.leftover {
                tracing::warn!(%leftover, "capture leftover in the library");
            }
            let moved = Entry {
                path: target.path.to_string_lossy().into_owned(),
                in_library: false,
                ..entry
            };
            index.update(moved.clone());
            Ok(moved)
        })?;
        // The card follows the file, so dragging it out still works.
        self.close_card(id);
        self.show_entry_card(&moved)
    }
}

struct Decoded {
    png: Vec<u8>,
    picture: image::DynamicImage,
}

fn decode_png(png_base64: &str) -> Result<Decoded, Error> {
    let bad = |message: &str| Error::BadImage(message.to_owned());
    let text = png_base64.trim();
    let text = text.strip_prefix("data:image/png;base64,").unwrap_or(text);
    if text.len() / 4 * 3 > MAX_EDITED_BYTES + 3 {
        return Err(bad("it is larger than 80 MB"));
    }
    let png = base64::engine::general_purpose::STANDARD
        .decode(text)
        .map_err(|error| Error::BadImage(error.to_string()))?;
    if png.len() > MAX_EDITED_BYTES {
        return Err(bad("it is larger than 80 MB"));
    }
    if !png.starts_with(PNG_SIGNATURE) {
        return Err(bad("it is not a PNG"));
    }
    let picture = image::load_from_memory_with_format(&png, image::ImageFormat::Png)
        .map_err(|error| Error::BadImage(error.to_string()))?;
    Ok(Decoded { png, picture })
}

fn encode_jpeg(picture: &image::DynamicImage) -> Result<Vec<u8>, Error> {
    let mut bytes = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, JPEG_QUALITY);
    picture
        .to_rgb8()
        .write_with_encoder(encoder)
        .map_err(|error| Error::BadImage(error.to_string()))?;
    Ok(bytes)
}

fn write_thumbnail(picture: &image::DynamicImage, path: &Path) -> Result<(), Error> {
    let long_edge = picture.width().max(picture.height());
    let small = if long_edge > THUMBNAIL_LONG_EDGE {
        picture.thumbnail(THUMBNAIL_LONG_EDGE, THUMBNAIL_LONG_EDGE)
    } else {
        picture.clone()
    };
    let mut bytes = Cursor::new(Vec::new());
    small
        .write_to(&mut bytes, image::ImageFormat::Png)
        .map_err(|error| Error::BadImage(error.to_string()))?;
    write_atomic(path, bytes.get_ref(), true)?;
    Ok(())
}
