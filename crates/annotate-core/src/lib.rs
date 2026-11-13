//! Annotation bundles: what a screen recording with red ink and narration becomes, for a coding
//! agent to read.
//!
//! The host records the display under the pointer to `recording.mp4`, the microphone to
//! `audio.wav`, the ink as [`Stroke`]s ([`Stroke::from_points`]) and small candidate frames a few
//! times a second, all inside a folder named by [`new_bundle_id`]; transcribes the audio into a
//! [`Transcript`] with word times; then calls [`finalize`], which writes:
//!
//! ```text
//! annotation-<ms>-<pid>/
//!   recording.mp4, audio.wav   (the host's)
//!   frames/frame-01.png …      key frames at full size, with the ink and their number
//!   contact-sheet.png          every key frame on one image, ≤ 1,600 px on its long edge
//!   summary.md                 the text to paste beside the contact sheet
//!   annotation.json            the manifest, written last: a folder with one is complete
//! ```
//!
//! Every time is in milliseconds from the start of the capture (the annotation clock); every
//! position is normalized to the recorded display, from its top-left corner.
//! [`library`] reads bundles back and [`retention`] cleans them up.
//!
//! The selection, shapes, rendering and summary are ported from Hex's Annotate (MIT, © 2026
//! Christopher Langton); see each module.

mod finalize;
mod keyframes;
pub mod library;
mod model;
mod render;
pub mod retention;
mod sketch;
mod summary;

use std::path::{Path, PathBuf};

pub use finalize::{
    BUNDLE_PREFIX, Finalized, FrameSource, Recording, finalize, new_bundle_id, now_ms,
};
pub use keyframes::select_keyframes;
pub use model::*;
pub use render::{decode_png, downscale, draw_badge, draw_ink, encode_png, render_contact_sheet};
pub use sketch::{describe_mark, marks_of, marks_on, shape_of};
pub use summary::{LOOK_AT_IMAGES, summary_markdown};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{}: {source}", path.display())]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Image(#[from] image::ImageError),
    #[error("a {width}×{height} frame needs {} bytes, not {len}", *width as usize * *height as usize * 4)]
    InvalidFrame { width: u32, height: u32, len: usize },
    #[error("annotation.json version {0} is newer than this build reads")]
    Version(u32),
}

fn io_at(path: &Path) -> impl FnOnce(std::io::Error) -> Error + '_ {
    move |source| Error::Io {
        path: path.to_path_buf(),
        source,
    }
}
