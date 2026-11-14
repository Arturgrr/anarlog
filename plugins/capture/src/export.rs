//! The editor's Save As: a PNG the webview made, written where the user
//! chose. It adds no entry; written over a capture's own file, it saves
//! that capture as Save does (a JPEG stays a JPEG) and refreshes its entry.

use std::path::Path;
use std::sync::Arc;

use tauri::Manager;

use anlg_capture_core::fs::write_atomic;
use base64::Engine;

use crate::Error;
use crate::session::{Session, blocking};

/// The same limit as `save_edited`, decoded.
const MAX_BYTES: usize = 80 * 1024 * 1024;
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

/// Writes a base64 PNG of at most 80 MB to `dest_path`, an absolute file
/// path, replacing what is there.
#[tauri::command]
#[specta::specta]
pub(crate) async fn export_png<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    dest_path: String,
    png_base64: String,
) -> Result<(), String> {
    let session = app
        .try_state::<Arc<Session>>()
        .map(|state| state.inner().clone());
    blocking(move || export(session.as_ref(), Path::new(&dest_path), &png_base64))
        .await
        .and_then(|done| done)
        .map_err(|error| error.to_string())
}

pub(crate) fn export(
    session: Option<&Arc<Session>>,
    dest: &Path,
    png_base64: &str,
) -> Result<(), Error> {
    let capture = match session {
        Some(session) if dest.is_absolute() => {
            session.entry_at(dest)?.map(|entry| (session, entry))
        }
        _ => None,
    };
    match capture {
        Some((session, entry)) if entry.kind == anlg_capture_core::Kind::Screenshot => session
            .save_edited(&entry.id, png_base64, true, false)
            .map(drop),
        Some(_) => Err(Error::OverRecording),
        None => write_png(dest, png_base64),
    }
}

fn write_png(dest: &Path, png_base64: &str) -> Result<(), Error> {
    if !dest.is_absolute() || dest.file_name().is_none() || dest.is_dir() {
        return Err(Error::BadDestination);
    }
    let bad = |message: &str| Error::BadImage(message.to_owned());
    let text = png_base64.trim();
    let text = text.strip_prefix("data:image/png;base64,").unwrap_or(text);
    if text.len() / 4 * 3 > MAX_BYTES + 3 {
        return Err(bad("it is larger than 80 MB"));
    }
    let png = base64::engine::general_purpose::STANDARD
        .decode(text)
        .map_err(|error| Error::BadImage(error.to_string()))?;
    if png.len() > MAX_BYTES {
        return Err(bad("it is larger than 80 MB"));
    }
    if !png.starts_with(PNG_SIGNATURE) {
        return Err(bad("it is not a PNG"));
    }
    image::load_from_memory_with_format(&png, image::ImageFormat::Png)
        .map_err(|error| Error::BadImage(error.to_string()))?;
    write_atomic(dest, &png, false)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png() -> String {
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::RgbaImage::new(2, 1)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        base64::engine::general_purpose::STANDARD.encode(bytes.into_inner())
    }

    #[test]
    fn export_png_writes_only_a_real_png_to_an_absolute_path() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("edited.png");

        assert!(matches!(
            write_png(Path::new("edited.png"), &png()),
            Err(Error::BadDestination)
        ));
        let not_png = base64::engine::general_purpose::STANDARD.encode(b"GIF89a");
        assert!(matches!(
            write_png(&dest, &not_png),
            Err(Error::BadImage(_))
        ));
        assert!(!dest.exists());

        write_png(&dest, &png()).unwrap();
        let written = std::fs::read(&dest).unwrap();
        assert!(written.starts_with(PNG_SIGNATURE));
    }
}
