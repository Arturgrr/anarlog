//! Annotations recorded by the desktop app: screen recordings with red ink
//! and narration, each a folder `anlg_annotate_core` reads, kept beside the
//! database in `annotations/`.

use std::path::{Component, Path, PathBuf};

use base64::Engine as _;
use serde::Serialize;

/// Where the desktop app keeps the annotations for the database at `db_path`.
pub fn root_for(db_path: &Path) -> PathBuf {
    db_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("annotations")
}

pub const DEFAULT_LIMIT: u32 = 20;
pub const MAX_LIMIT: u32 = 100;
/// The largest contact sheet returned as image content; a larger one is
/// left to its path.
pub const MAX_IMAGE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
pub struct ListAnnotationsInput {
    /// How many to return, newest first (default 20, at most 100).
    pub limit: Option<u32>,
}

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
pub struct GetAnnotationInput {
    /// An id from list_annotations; the newest annotation when omitted.
    pub id: Option<String>,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct AnnotationListItem {
    pub id: String,
    /// When the recording started, in ms since the Unix epoch.
    pub created_at_ms: u64,
    pub duration_ms: u64,
    /// The app in front when it started.
    pub app: Option<String>,
    pub window_title: Option<String>,
    /// The annotation's folder on this computer.
    pub folder: String,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct AnnotationList {
    pub annotations: Vec<AnnotationListItem>,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct AnnotationDetail {
    #[serde(flatten)]
    pub item: AnnotationListItem,
    /// The summary.md text: what was said and marked, frame by frame.
    pub summary: String,
    /// The narration's transcript.
    pub transcript: String,
    /// Every key frame on one image; also returned as image content.
    pub contact_sheet: String,
    /// The numbered key frames at full size, with the ink drawn on them.
    pub key_frames: Vec<String>,
    /// The screen recording, until retention removes it.
    pub video: Option<String>,
    /// The narration audio, until retention removes it.
    pub audio: Option<String>,
}

fn item(entry: &anlg_annotate_core::library::Entry) -> AnnotationListItem {
    let annotation = &entry.annotation;
    AnnotationListItem {
        id: annotation.id.clone(),
        created_at_ms: annotation.created_at_ms,
        duration_ms: annotation.duration_ms,
        app: annotation.target.app.clone(),
        window_title: annotation.target.window_title.clone(),
        folder: entry.dir.to_string_lossy().into_owned(),
    }
}

pub fn list(root: &Path, limit: Option<u32>) -> AnnotationList {
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT) as usize;
    AnnotationList {
        annotations: anlg_annotate_core::library::list(root)
            .iter()
            .take(limit)
            .map(item)
            .collect(),
    }
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("no annotation found")]
    None,
    #[error("annotation {0} not found")]
    NotFound(String),
    #[error("could not read the annotation: {0}")]
    Read(String),
}

/// `name`, as the manifest gives it, when it is a file inside `dir`: a
/// relative path of plain parts (`contact-sheet.png`, `frames/frame-01.png`)
/// that still resolves inside the folder, links followed.
fn inside(dir: &Path, name: &str) -> Option<PathBuf> {
    let relative = Path::new(name);
    let plain = relative.components().next().is_some()
        && relative
            .components()
            .all(|part| matches!(part, Component::Normal(_)));
    if !plain {
        return None;
    }
    let path = dir.join(relative);
    let real = path.canonicalize().ok()?;
    (real.starts_with(dir.canonicalize().ok()?) && real.is_file()).then_some(path)
}

/// The annotation `id`, or the newest, with its contact sheet's bytes when
/// they are small enough to return as an image. Ids are folder names, never
/// paths.
pub fn get(root: &Path, id: Option<&str>) -> Result<(AnnotationDetail, Option<Vec<u8>>), Error> {
    let entry = match id {
        None => anlg_annotate_core::library::latest(root).ok_or(Error::None)?,
        Some(id) => {
            let valid = id.starts_with(anlg_annotate_core::BUNDLE_PREFIX)
                && !id.contains(['/', '\\'])
                && !id.contains("..");
            if !valid {
                return Err(Error::NotFound(id.to_owned()));
            }
            let dir = root.join(id);
            let annotation = anlg_annotate_core::library::read(&dir)
                .map_err(|_| Error::NotFound(id.to_owned()))?;
            anlg_annotate_core::library::Entry { dir, annotation }
        }
    };
    let dir = &entry.dir;
    let path = |name: &str| inside(dir, name).map(|path| path.to_string_lossy().into_owned());
    let summary = std::fs::read_to_string(dir.join(anlg_annotate_core::SUMMARY_FILE))
        .map_err(|error| Error::Read(error.to_string()))?;
    let annotation = &entry.annotation;
    let sheet_path = inside(dir, &annotation.contact_sheet)
        .ok_or_else(|| Error::Read("the contact sheet is not in the annotation's folder".into()))?;
    let size = std::fs::metadata(&sheet_path)
        .map_err(|error| Error::Read(error.to_string()))?
        .len();
    let sheet = if size <= MAX_IMAGE_BYTES {
        Some(std::fs::read(&sheet_path).map_err(|error| Error::Read(error.to_string()))?)
    } else {
        None
    };
    let detail = AnnotationDetail {
        item: item(&entry),
        summary,
        transcript: annotation.transcript.text.clone(),
        contact_sheet: sheet_path.to_string_lossy().into_owned(),
        key_frames: annotation
            .keyframes
            .iter()
            .filter_map(|k| path(&k.file))
            .collect(),
        video: annotation.video.as_deref().and_then(path),
        audio: annotation.audio.as_deref().and_then(path),
    };
    Ok((detail, sheet))
}

pub fn base64_png(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_files_inside_the_annotation_folder_are_named_or_read() {
        let root = tempfile::tempdir().unwrap();
        let outside = root.path().join("secret.png");
        std::fs::write(&outside, b"secret").unwrap();
        let dir = root.path().join("annotation-1");
        std::fs::create_dir_all(dir.join("frames")).unwrap();
        std::fs::write(dir.join("contact-sheet.png"), b"png").unwrap();
        std::fs::write(dir.join("frames/frame-01.png"), b"png").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, dir.join("link.png")).unwrap();

        assert!(inside(&dir, "contact-sheet.png").is_some());
        assert!(inside(&dir, "frames/frame-01.png").is_some());
        for tampered in [
            "../secret.png",
            "frames/../../secret.png",
            outside.to_str().unwrap(),
            "link.png",
            "",
            "frames",
        ] {
            assert_eq!(inside(&dir, tampered), None, "{tampered}");
        }
    }
}
