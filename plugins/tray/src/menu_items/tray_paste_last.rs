use tauri::{
    AppHandle, Result,
    menu::{MenuItem, MenuItemKind},
};

use super::MenuItemHandler;

pub struct TrayPasteLast;

impl MenuItemHandler for TrayPasteLast {
    const ID: &'static str = "anlg_tray_paste_last";

    fn build(app: &AppHandle<tauri::Wry>) -> Result<MenuItemKind<tauri::Wry>> {
        let item = MenuItem::with_id(
            app,
            Self::ID,
            crate::labels::labels().paste_last_dictation,
            true,
            None::<&str>,
        )?;
        Ok(MenuItemKind::MenuItem(item))
    }

    // The same event as the paste-last shortcut, so both take one path.
    fn handle(app: &AppHandle<tauri::Wry>) {
        use tauri_specta::Event;

        let _ = tauri_plugin_shortcut::PasteLastEvent {}.emit(app);
    }
}
