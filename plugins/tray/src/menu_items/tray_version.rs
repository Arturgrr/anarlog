use tauri::{
    AppHandle, Result,
    menu::{MenuItem, MenuItemKind},
};

use super::MenuItemHandler;

pub struct TrayVersion;

impl TrayVersion {
    fn get_channel(identifier: &str) -> &'static str {
        match identifier {
            "com.arturgrr.librelog"
            | "com.arturgrr.librelog.desktop"
            | "io.github.arturgrr.Librelog" => "stable",
            "com.arturgrr.librelog.nightly" => "nightly",
            "com.arturgrr.librelog.staging" => "staging",
            _ => "dev",
        }
    }
}

impl MenuItemHandler for TrayVersion {
    const ID: &'static str = "anlg_tray_version";

    fn build(app: &AppHandle<tauri::Wry>) -> Result<MenuItemKind<tauri::Wry>> {
        let identifier = &app.config().identifier;
        let app_version = app.package_info().version.to_string();
        let channel = Self::get_channel(identifier);

        let text = format!("v{} ({})", app_version, channel);
        let item = MenuItem::with_id(app, Self::ID, text, false, None::<&str>)?;
        Ok(MenuItemKind::MenuItem(item))
    }

    fn handle(_app: &AppHandle<tauri::Wry>) {}
}
