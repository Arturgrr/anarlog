use anlg_local_llm::{Endpoint, LlmModel, ServerState};

use crate::{LlmError, LlmModelEntry, LocalLlmPluginExt, RuntimeStatus};

#[tauri::command]
#[specta::specta]
pub async fn runtime_status<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<RuntimeStatus, LlmError> {
    Ok(app.local_llm().runtime_status())
}

#[tauri::command]
#[specta::specta]
pub async fn list_models<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<LlmModelEntry>, LlmError> {
    Ok(app.local_llm().list_models().await)
}

#[tauri::command]
#[specta::specta]
pub async fn models_dir<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<String, LlmError> {
    Ok(app.local_llm().models_dir().to_string_lossy().to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn download_model<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    model: LlmModel,
) -> Result<(), LlmError> {
    app.local_llm().download_model(model).await
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_download<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    model: LlmModel,
) -> Result<bool, LlmError> {
    app.local_llm().cancel_download(model).await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_model<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    model: LlmModel,
) -> Result<(), LlmError> {
    app.local_llm().delete_model(model).await
}

#[tauri::command]
#[specta::specta]
pub async fn is_model_downloading<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    model: LlmModel,
) -> Result<bool, LlmError> {
    Ok(app.local_llm().is_model_downloading(model).await)
}

#[tauri::command]
#[specta::specta]
pub async fn ensure_server<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    model: LlmModel,
) -> Result<Endpoint, LlmError> {
    app.local_llm().ensure_server(model).await
}

#[tauri::command]
#[specta::specta]
pub async fn stop_server<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), LlmError> {
    app.local_llm().stop_server().await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn server_state<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<ServerState, LlmError> {
    Ok(app.local_llm().server_state())
}
