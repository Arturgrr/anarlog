//! Reading finished bundles back, for the CLI and the MCP tool.

use std::path::{Path, PathBuf};

use crate::model::*;
use crate::{Error, io_at};

/// A complete bundle found in a folder of annotations.
#[derive(Clone, Debug)]
pub struct Entry {
    pub dir: PathBuf,
    pub annotation: Annotation,
}

/// Reads `dir`'s manifest. `video` and `audio` are left out when their files are gone (retention
/// deletes media before the rest).
pub fn read(dir: &Path) -> Result<Annotation, Error> {
    let path = dir.join(MANIFEST);
    let bytes = std::fs::read(&path).map_err(io_at(&path))?;
    let mut annotation: Annotation = serde_json::from_slice(&bytes)?;
    if annotation.version > VERSION {
        return Err(Error::Version(annotation.version));
    }
    for media in [&mut annotation.video, &mut annotation.audio] {
        if media.as_ref().is_some_and(|name| !dir.join(name).is_file()) {
            *media = None;
        }
    }
    Ok(annotation)
}

/// Every complete bundle directly inside `root`, newest first. Folders without a readable
/// manifest (still being written, abandoned, or from a newer version) are skipped.
pub fn list(root: &Path) -> Vec<Entry> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut found: Vec<Entry> = entries
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|dir| dir.is_dir())
        .filter_map(|dir| {
            let annotation = read(&dir).ok()?;
            Some(Entry { dir, annotation })
        })
        .collect();
    found.sort_by(|a, b| {
        b.annotation
            .created_at_ms
            .cmp(&a.annotation.created_at_ms)
            .then_with(|| b.dir.cmp(&a.dir))
    });
    found
}

/// The newest complete bundle in `root`.
pub fn latest(root: &Path) -> Option<Entry> {
    list(root).into_iter().next()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundle(root: &Path, name: &str, created_at_ms: u64) -> PathBuf {
        let dir = root.join(name);
        std::fs::create_dir_all(&dir).unwrap();
        let annotation = serde_json::json!({
            "version": 1, "id": name, "createdAtMs": created_at_ms, "durationMs": 1_000,
            "target": {"width": 100.0, "height": 100.0, "scale": 2.0},
            "transcript": {"source": "test", "text": ""},
            "strokes": [], "marks": [], "keyframes": [], "contactSheet": "contact-sheet.png",
            "video": "recording.mp4", "videoOffsetMs": 0, "audio": "audio.wav"
        });
        std::fs::write(dir.join(MANIFEST), annotation.to_string()).unwrap();
        std::fs::write(dir.join(AUDIO_FILE), b"wav").unwrap();
        dir
    }

    #[test]
    fn lists_complete_bundles_newest_first_and_skips_the_rest() {
        let root = tempfile::tempdir().unwrap();
        let older = bundle(root.path(), "annotation-1", 1_000);
        let newer = bundle(root.path(), "annotation-2", 2_000);
        std::fs::create_dir(root.path().join("annotation-3")).unwrap();
        let broken = root.path().join("annotation-4");
        std::fs::create_dir(&broken).unwrap();
        std::fs::write(broken.join(MANIFEST), b"{").unwrap();
        let future = bundle(root.path(), "annotation-5", 3_000);
        let text = std::fs::read_to_string(future.join(MANIFEST)).unwrap();
        std::fs::write(
            future.join(MANIFEST),
            text.replace("\"version\":1", "\"version\":2"),
        )
        .unwrap();
        std::fs::write(root.path().join("stray.txt"), b"").unwrap();

        let dirs: Vec<_> = list(root.path()).into_iter().map(|e| e.dir).collect();
        assert_eq!(dirs, [newer.clone(), older]);
        let latest = latest(root.path()).unwrap();
        assert_eq!(latest.dir, newer);
        // The deleted video is no longer offered; the audio still is.
        assert_eq!(latest.annotation.video, None);
        assert_eq!(latest.annotation.audio.as_deref(), Some(AUDIO_FILE));
        assert!(list(&root.path().join("missing")).is_empty());
    }
}
