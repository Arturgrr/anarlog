use std::sync::Arc;

use tauri::Manager;

use crate::session::{Session, blocking};
use crate::types::{
    CaptureEntry, CaptureOutcome, CaptureStatus, RecordingRequest, RecordingStart,
    ScreenshotRequest, SystemShortcuts,
};
use crate::{Error, system};

type Result<T> = std::result::Result<T, String>;

fn session<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Arc<Session> {
    app.state::<Arc<Session>>().inner().clone()
}

/// Runs `work` on a worker thread with the session.
async fn on_worker<R: tauri::Runtime, T: Send + 'static>(
    app: &tauri::AppHandle<R>,
    work: impl FnOnce(Arc<Session>) -> std::result::Result<T, Error> + Send + 'static,
) -> Result<T> {
    let session = session(app);
    blocking(move || work(session))
        .await
        .and_then(|done| done)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn status<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<CaptureStatus> {
    Ok(session(&app).status())
}

/// Shows the selector (none for `fullscreen`) and saves the screenshot as
/// the request asks; then emits `captured`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn screenshot<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: ScreenshotRequest,
) -> Result<CaptureOutcome> {
    session(&app)
        .screenshot(request)
        .await
        .map_err(|error| error.to_string())
}

/// Shows the live selector and the countdown, and returns once frames are
/// being written.
#[tauri::command]
#[specta::specta]
pub(crate) async fn start_recording<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: RecordingRequest,
) -> Result<RecordingStart> {
    session(&app)
        .start_recording(request)
        .await
        .map_err(|error| error.to_string())
}

/// Ends the recording and finishes it (the GIF made, for a GIF); then emits
/// `captured`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn stop_recording<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<CaptureOutcome> {
    session(&app)
        .stop_recording()
        .await
        .map_err(|error| error.to_string())
}

/// Ends the recording, or its selector or countdown, and deletes the movie.
#[tauri::command]
#[specta::specta]
pub(crate) async fn cancel_recording<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<()> {
    session(&app)
        .cancel_recording()
        .await
        .map_err(|error| error.to_string())
}

/// Newest first; entries whose file is gone are dropped.
#[tauri::command]
#[specta::specta]
pub(crate) async fn list_captures<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<CaptureEntry>> {
    on_worker(&app, |session| session.list_captures()).await
}

/// Deletes a library capture's file; one saved to the user's folder goes to
/// the Trash.
#[tauri::command]
#[specta::specta]
pub(crate) async fn delete_capture<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<()> {
    on_worker(&app, move |session| session.delete_capture(&id)).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn copy_capture<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<()> {
    on_worker(&app, move |session| session.copy_capture(&id)).await
}

/// Copies the capture's file to `destPath`, an absolute file path; returns
/// the entry, which is unchanged.
#[tauri::command]
#[specta::specta]
pub(crate) async fn save_capture_as<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    dest_path: String,
) -> Result<CaptureEntry> {
    on_worker(&app, move |session| {
        session.save_capture_as(&id, &dest_path)
    })
    .await
}

/// Saves an edited screenshot, a base64 PNG of at most 80 MB: over the
/// capture's file when `replace` (as a JPEG when it is one), else as a new
/// capture beside it. `copy` also puts it on the clipboard.
#[tauri::command]
#[specta::specta]
pub(crate) async fn save_edited<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    png_base64: String,
    replace: bool,
    copy: bool,
) -> Result<CaptureEntry> {
    on_worker(&app, move |session| {
        session.save_edited(&id, &png_base64, replace, copy)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn show_card<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<()> {
    on_worker(&app, move |session| session.show_card(&id)).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn close_cards<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<()> {
    session(&app)
        .close_cards()
        .map_err(|error| error.to_string())
}

/// Which of macOS's own screenshot shortcuts are on (true = on).
#[tauri::command]
#[specta::specta]
pub(crate) async fn system_shortcuts<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<SystemShortcuts> {
    on_worker(&app, |session| system::read(&session.layout)).await
}

/// Turns macOS's ⌘⇧3, ⌘⇧4 and ⌘⇧5 off, remembering how they were, and
/// returns what is on afterwards.
#[tauri::command]
#[specta::specta]
pub(crate) async fn replace_system_shortcuts<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<SystemShortcuts> {
    on_worker(&app, |session| system::replace(&session.layout)).await
}

/// Puts macOS's screenshot shortcuts back as they were.
#[tauri::command]
#[specta::specta]
pub(crate) async fn restore_system_shortcuts<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<SystemShortcuts> {
    on_worker(&app, |session| system::restore(&session.layout)).await
}
