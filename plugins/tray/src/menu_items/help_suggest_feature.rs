use tauri::{
    AppHandle, Result,
    menu::{MenuItem, MenuItemKind},
};

use super::MenuItemHandler;

pub struct HelpSuggestFeature;

impl MenuItemHandler for HelpSuggestFeature {
    const ID: &'static str = "anlg_help_suggest_feature";

    fn build(app: &AppHandle<tauri::Wry>) -> Result<MenuItemKind<tauri::Wry>> {
        let item = MenuItem::with_id(
            app,
            Self::ID,
            crate::labels::labels().suggest_feature,
            true,
            None::<&str>,
        )?;
        Ok(MenuItemKind::MenuItem(item))
    }

    fn handle(_app: &AppHandle<tauri::Wry>) {
        let _ = open::that("https://github.com/Arturgrr/librelog/issues");
    }
}
