use std::sync::Arc;

use anlg_annotate_core::retention::Preset;
use tauri::Manager;

use crate::bundle::{Finalized, TranscriptInput};
use crate::events::Stopped;
use crate::session::{CapsuleLabels, Session, Started, Status};
use crate::{Error, blocking_native};

type Result<T> = std::result::Result<T, String>;

fn text(error: Error) -> String {
    error.to_string()
}

fn session<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Arc<Session> {
    app.state::<Arc<Session>>().inner().clone()
}

/// `granted`, `denied`, `not_determined` or `needs_restart` (granted, but
/// only a relaunch lets this process record).
#[tauri::command]
#[specta::specta]
pub(crate) async fn screen_recording<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<String> {
    let native = session(&app).native().clone();
    blocking_native(move || native.probe_screen_recording())
        .await
        .map_err(text)
}

/// Shows the system prompt, which macOS shows once.
#[tauri::command]
#[specta::specta]
pub(crate) async fn request_screen_recording<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<bool> {
    let native = session(&app).native().clone();
    blocking_native(move || native.request_screen_recording())
        .await
        .map_err(text)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn open_screen_recording_settings<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<()> {
    let native = session(&app).native().clone();
    blocking_native(move || native.open_screen_recording_settings())
        .await
        .map_err(text)
}

/// Starts recording the display under the pointer and the microphone.
#[tauri::command]
#[specta::specta]
pub(crate) async fn start<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    microphone_device: Option<String>,
    labels: Option<CapsuleLabels>,
) -> Result<Started> {
    let audio = app
        .state::<Arc<dyn anlg_audio::AudioProvider>>()
        .inner()
        .clone();
    session(&app)
        .start(audio, microphone_device, labels)
        .await
        .map_err(text)
}

/// Stops the screen and the microphone; the recording waits for `finalize`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn stop<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<Stopped> {
    session(&app).stop().await.map_err(text)
}

/// Writes the bundle of the stopped recording `id`. `transcript` is null when
/// transcription failed or found no speech.
#[tauri::command]
#[specta::specta]
pub(crate) async fn finalize<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    transcript: Option<TranscriptInput>,
) -> Result<Finalized> {
    session(&app).finalize(&id, transcript).await.map_err(text)
}

/// Throws away the recording, or the stopped one waiting for `finalize`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn cancel<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<()> {
    session(&app).cancel().await.map_err(text)
}

#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum InkMode {
    Off,
    /// The pointer inks as it moves: while the shortcut is held.
    Hover,
    /// The pointer inks while its button is down.
    Drag,
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn set_ink_mode<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    mode: InkMode,
) -> Result<()> {
    let mode = match mode {
        InkMode::Off => "off",
        InkMode::Hover => "hover",
        InkMode::Drag => "drag",
    };
    session(&app).set_ink_mode(mode).map_err(text)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn status<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<Status> {
    Ok(session(&app).status())
}

#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Retention {
    Week,
    Month,
    Forever,
}

/// Sets how long annotations are kept and applies it now; it is applied again
/// every hour, never while recording.
#[tauri::command]
#[specta::specta]
pub(crate) async fn set_retention<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    retention: Retention,
) -> Result<()> {
    let session = session(&app);
    session.set_retention(match retention {
        Retention::Week => Preset::Week,
        Retention::Month => Preset::Month,
        Retention::Forever => Preset::Forever,
    });
    session.run_retention().await;
    Ok(())
}

/// The folder that holds the annotations, created when missing.
#[tauri::command]
#[specta::specta]
pub(crate) async fn annotations_dir<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<String> {
    let root = session(&app).root().to_path_buf();
    std::fs::create_dir_all(&root).map_err(|error| text(error.into()))?;
    Ok(root.to_string_lossy().into_owned())
}

/// The newest finished annotation.
#[tauri::command]
#[specta::specta]
pub(crate) async fn latest<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Option<Finalized>> {
    let root = session(&app).root().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || crate::bundle::latest(&root))
        .await
        .map_err(|error| error.to_string())?
        .map_err(text)
}
