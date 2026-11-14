use tauri::{
    AppHandle, Result,
    menu::{MenuItem, MenuItemKind},
};
use tauri_plugin_shortcut::{CaptureAction, CaptureShortcutEvent};

use super::MenuItemHandler;

// The same event as the Capture shortcuts, so a click takes their path.
fn emit(app: &AppHandle<tauri::Wry>, action: CaptureAction) {
    use tauri_specta::Event;

    let _ = CaptureShortcutEvent { action }.emit(app);
}

pub struct TrayCaptureArea;

impl MenuItemHandler for TrayCaptureArea {
    const ID: &'static str = "anlg_tray_capture_area";

    fn build(app: &AppHandle<tauri::Wry>) -> Result<MenuItemKind<tauri::Wry>> {
        let item = MenuItem::with_id(
            app,
            Self::ID,
            crate::labels::labels().capture_area,
            true,
            None::<&str>,
        )?;
        Ok(MenuItemKind::MenuItem(item))
    }

    fn handle(app: &AppHandle<tauri::Wry>) {
        emit(app, CaptureAction::Area);
    }
}

pub struct TrayRecordScreen;

impl MenuItemHandler for TrayRecordScreen {
    const ID: &'static str = "anlg_tray_record_screen";

    fn build(app: &AppHandle<tauri::Wry>) -> Result<MenuItemKind<tauri::Wry>> {
        let item = MenuItem::with_id(
            app,
            Self::ID,
            crate::labels::labels().record_screen,
            true,
            None::<&str>,
        )?;
        Ok(MenuItemKind::MenuItem(item))
    }

    fn handle(app: &AppHandle<tauri::Wry>) {
        emit(app, CaptureAction::Record);
    }
}
