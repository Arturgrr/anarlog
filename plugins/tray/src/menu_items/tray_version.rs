use tauri::{
    AppHandle, Result,
    menu::{MenuItem, MenuItemKind},
};

use super::MenuItemHandler;

pub struct TrayVersion;

impl TrayVersion {
    fn get_channel(identifier: &str, prerelease: bool) -> &'static str {
        match identifier {
            "com.arturgrr.librelog"
            | "com.arturgrr.librelog.desktop"
            | "io.github.arturgrr.Librelog" => {
                if prerelease {
                    "beta"
                } else {
                    "stable"
                }
            }
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
        let version = &app.package_info().version;
        let app_version = version.to_string();
        let channel = Self::get_channel(identifier, !version.pre.is_empty());

        let text = format!("v{} ({})", app_version, channel);
        let item = MenuItem::with_id(app, Self::ID, text, false, None::<&str>)?;
        Ok(MenuItemKind::MenuItem(item))
    }

    fn handle(_app: &AppHandle<tauri::Wry>) {}
}
