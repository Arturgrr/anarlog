mod app_info;
mod app_new;
mod help_report_bug;
mod help_suggest_feature;
mod tray_check_update;
mod tray_hide;
mod tray_open;
mod tray_quit;
mod tray_quit_completely;
mod tray_settings;
mod tray_start;
mod tray_version;

pub use app_info::AppInfo;
pub use app_new::AppNew;
pub use help_report_bug::HelpReportBug;
pub use help_suggest_feature::HelpSuggestFeature;
pub use tray_check_update::{TrayCheckUpdate, UpdateMenuState};
pub use tray_hide::TrayHide;
pub use tray_open::TrayOpen;
pub use tray_quit::TrayQuit;
pub use tray_quit_completely::{TrayQuitCompletely, quit_completely};
pub use tray_settings::TraySettings;
pub use tray_start::TrayStart;
pub use tray_version::TrayVersion;

use tauri::{AppHandle, Result, menu::MenuItemKind};

pub trait MenuItemHandler {
    const ID: &'static str;

    fn build(app: &AppHandle<tauri::Wry>) -> Result<MenuItemKind<tauri::Wry>>;
    fn handle(app: &AppHandle<tauri::Wry>);
}

macro_rules! menu_items {
    ($($variant:ident => $item:ty),* $(,)?) => {
        #[derive(Debug, Clone, Copy)]
        pub enum AnlgMenuItem {
            $($variant),*
        }

        impl From<AnlgMenuItem> for tauri::menu::MenuId {
            fn from(value: AnlgMenuItem) -> Self {
                match value {
                    $(AnlgMenuItem::$variant => <$item as MenuItemHandler>::ID),*
                }.into()
            }
        }

        impl TryFrom<tauri::menu::MenuId> for AnlgMenuItem {
            type Error = ();

            fn try_from(id: tauri::menu::MenuId) -> std::result::Result<Self, Self::Error> {
                let id = id.0.as_str();
                match id {
                    $(<$item as MenuItemHandler>::ID => Ok(AnlgMenuItem::$variant),)*
                    _ => Err(()),
                }
            }
        }

        impl AnlgMenuItem {
            pub fn handle(self, app: &AppHandle<tauri::Wry>) {
                match self {
                    $(AnlgMenuItem::$variant => <$item>::handle(app)),*
                }
            }
        }
    };
}

menu_items! {
    TrayOpen => TrayOpen,
    TrayStart => TrayStart,
    TraySettings => TraySettings,
    TrayCheckUpdate => TrayCheckUpdate,
    TrayHide => TrayHide,
    TrayQuit => TrayQuit,
    TrayQuitCompletely => TrayQuitCompletely,
    TrayVersion => TrayVersion,
    AppInfo => AppInfo,
    AppNew => AppNew,
    HelpReportBug => HelpReportBug,
    HelpSuggestFeature => HelpSuggestFeature,
}
