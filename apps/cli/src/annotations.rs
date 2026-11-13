//! Annotations recorded by the desktop app: screen recordings with red ink
//! and narration, each a folder `anlg_annotate_core` reads, kept beside the
//! database in `annotations/`.

use std::path::{Path, PathBuf};

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

/// The annotation `id`, or the newest. Ids are folder names, never paths.
pub fn get(root: &Path, id: Option<&str>) -> Result<(AnnotationDetail, Vec<u8>), Error> {
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
    let path = |name: &str| dir.join(name).to_string_lossy().into_owned();
    let summary = std::fs::read_to_string(dir.join(anlg_annotate_core::SUMMARY_FILE))
        .map_err(|error| Error::Read(error.to_string()))?;
    let sheet = std::fs::read(dir.join(&entry.annotation.contact_sheet))
        .map_err(|error| Error::Read(error.to_string()))?;
    let annotation = &entry.annotation;
    let detail = AnnotationDetail {
        item: item(&entry),
        summary,
        transcript: annotation.transcript.text.clone(),
        contact_sheet: path(&annotation.contact_sheet),
        key_frames: annotation.keyframes.iter().map(|k| path(&k.file)).collect(),
        video: annotation.video.as_deref().map(path),
        audio: annotation.audio.as_deref().map(path),
    };
    Ok((detail, sheet))
}

pub fn base64_png(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}
