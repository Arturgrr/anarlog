#[tauri::command]
#[specta::specta]
pub async fn foundation_model_availability() -> Result<crate::FoundationModelAvailability, String> {
    crate::foundation_models::availability()
}

#[tauri::command]
#[specta::specta]
pub async fn foundation_model_begin(request_id: String) -> Result<(), String> {
    crate::foundation_models::begin(request_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn foundation_model_cancel(request_id: String) -> Result<(), String> {
    crate::foundation_models::cancel(request_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn foundation_model_generate(
    request: crate::FoundationModelRequest,
) -> Result<crate::FoundationModelResponse, String> {
    crate::foundation_models::generate(request).await
}
