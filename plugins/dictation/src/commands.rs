use std::sync::Arc;

use tauri::Manager;

use crate::{
    events::HudEvent,
    ext::DictationPluginExt,
    recorder::{RecordedAudio, Recorder},
};

#[tauri::command]
#[specta::specta]
pub(crate) async fn capture_target() -> Result<String, String> {
    crate::insertion::capture().await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn insert_text(target: String, text: String) -> Result<(), String> {
    if text.contains('\0') {
        return Err("Dictation text contains an unsupported NUL character".into());
    }
    if text.is_empty() || text.len() > 100_000 {
        return Err("Dictation text is empty or too long".into());
    }
    crate::insertion::insert(target, text).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn hud<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    event: HudEvent,
) -> Result<(), String> {
    app.dictation().hud(event).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn start_recording<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    microphone_device: Option<String>,
    owner: String,
) -> Result<(), String> {
    let audio = app
        .state::<Arc<dyn anlg_audio::AudioProvider>>()
        .inner()
        .clone();
    app.state::<Recorder>()
        .start(audio, microphone_device, owner)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn stop_recording<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    owner: String,
) -> Result<RecordedAudio, String> {
    app.state::<Recorder>()
        .stop(&owner)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn cancel_recording<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    owner: String,
) -> Result<(), String> {
    app.state::<Recorder>()
        .cancel(&owner)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn discard_recording<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    file_path: String,
) -> Result<(), String> {
    app.state::<Recorder>()
        .discard(file_path)
        .map_err(|error| error.to_string())
}

/// Records for system-wide dictation: the HUD follows the microphone, and the
/// live preview's words arrive over `updates`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn start_system_recording<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    microphone_device: Option<String>,
    owner: String,
    preview: Option<crate::preview::PreviewConfig>,
    updates: tauri::ipc::Channel<crate::preview::RecordingUpdate>,
) -> Result<(), String> {
    let audio = app
        .state::<Arc<dyn anlg_audio::AudioProvider>>()
        .inner()
        .clone();
    let hud = app.clone();
    let meter: crate::recorder::Meter = Arc::new(move |rms| hud.dictation().meter(rms));
    app.state::<Recorder>()
        .start_with_feedback(
            audio,
            microphone_device,
            owner,
            preview,
            Some(updates),
            Some(meter),
        )
        .map_err(|error| error.to_string())
}

/// The application in front right now, for the dictation history.
#[tauri::command]
#[specta::specta]
pub(crate) async fn frontmost_app() -> Result<Option<crate::target_app::TargetApp>, String> {
    Ok(crate::target_app::frontmost().await)
}

/// Moves a finished recording into the dictation history and returns its
/// file name there; the temporary recording is gone afterwards.
#[tauri::command]
#[specta::specta]
pub(crate) async fn keep_history_audio<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    file_path: String,
) -> Result<String, String> {
    let directory = crate::history::directory(&app).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::history::keep(&directory, &id, file_path, |path| {
            app.state::<Recorder>().discard(path)
        })
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn history_audio_path<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    file_name: String,
) -> Result<String, String> {
    let directory = crate::history::directory(&app).map_err(|error| error.to_string())?;
    crate::history::resolve(&directory, &file_name)
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn delete_history_audio<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    file_names: Vec<String>,
) -> Result<(), String> {
    let directory = crate::history::directory(&app).map_err(|error| error.to_string())?;
    crate::history::delete(&directory, &file_names).map_err(|error| error.to_string())
}

/// Deletes kept audio that no history entry refers to.
#[tauri::command]
#[specta::specta]
pub(crate) async fn prune_history_audio<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    referenced: Vec<String>,
) -> Result<(), String> {
    let directory = crate::history::directory(&app).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || crate::history::prune(&directory, &referenced))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}
