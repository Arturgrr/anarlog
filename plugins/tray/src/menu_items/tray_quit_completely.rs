use tauri::{
    AppHandle, Result,
    menu::{MenuItem, MenuItemKind},
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

use super::MenuItemHandler;

pub struct TrayQuitCompletely;

impl MenuItemHandler for TrayQuitCompletely {
    const ID: &'static str = "anlg_tray_quit_completely";

    fn build(app: &AppHandle<tauri::Wry>) -> Result<MenuItemKind<tauri::Wry>> {
        let item = MenuItem::with_id(
            app,
            Self::ID,
            crate::labels::labels().quit_completely,
            true,
            None::<&str>,
        )?;
        Ok(MenuItemKind::MenuItem(item))
    }

    fn handle(app: &AppHandle<tauri::Wry>) {
        let app_name = app.package_info().name.clone();
        let app = app.clone();
        let labels = crate::labels::labels();
        let values = [("app", app_name.as_str())];

        app.dialog()
            .message(crate::labels::fill(
                &labels.quit_completely_message,
                &values,
            ))
            .title(crate::labels::fill(&labels.quit_completely_title, &values))
            .buttons(MessageDialogButtons::OkCancelCustom(
                labels.quit_completely_confirm,
                labels.cancel,
            ))
            .show(move |confirmed| {
                if confirmed {
                    quit_completely(&app);
                }
            });
    }
}

pub fn quit_completely(app: &AppHandle<tauri::Wry>) {
    // Skip the frontend exit flush so the process terminates immediately.
    anlg_intercept::set_force_quit();
    app.exit(0);
}
