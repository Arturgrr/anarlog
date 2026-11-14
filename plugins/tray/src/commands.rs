use crate::TrayPluginExt;

#[tauri::command]
#[specta::specta]
pub async fn set_tray_icon_visible(
    app: tauri::AppHandle<tauri::Wry>,
    visible: bool,
) -> Result<(), String> {
    app.tray().set_visible(visible).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_tray_labels(
    app: tauri::AppHandle<tauri::Wry>,
    labels: crate::labels::TrayLabels,
) -> Result<(), String> {
    app.tray()
        .set_labels(labels)
        .map_err(|error| error.to_string())
}

/// Shows "Paste last dictation" in the menu bar icon's menu on macOS while
/// dictation and its paste-last shortcut are enabled. Other platforms never
/// show it.
#[tauri::command]
#[specta::specta]
pub async fn set_tray_paste_last_visible(
    app: tauri::AppHandle<tauri::Wry>,
    visible: bool,
) -> Result<(), String> {
    app.tray()
        .set_paste_last_visible(visible)
        .map_err(|error| error.to_string())
}

/// Shows "Capture Area" and "Record Screen" in the menu bar icon's menu
/// while Capture is on.
#[tauri::command]
#[specta::specta]
pub async fn set_tray_capture_visible(
    app: tauri::AppHandle<tauri::Wry>,
    visible: bool,
) -> Result<(), String> {
    app.tray()
        .set_capture_visible(visible)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn set_tray_recording_title(
    app: tauri::AppHandle<tauri::Wry>,
    title: Option<String>,
) -> Result<(), String> {
    app.tray()
        .set_recording_title(title)
        .map_err(|error| error.to_string())
}

/// Claims a "Start a new meeting" click from the menu bar icon. Returns true
/// once per click, so it starts one recording however many times it is asked.
#[tauri::command]
#[specta::specta]
pub async fn take_pending_tray_start() -> Result<bool, String> {
    Ok(crate::menu_items::TrayStart::take_pending_start())
}
