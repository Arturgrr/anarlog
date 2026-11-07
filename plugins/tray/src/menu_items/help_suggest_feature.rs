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

    fn handle(app: &AppHandle<tauri::Wry>) {
        crate::feedback::open_issue_form(app, crate::feedback::FEEDBACK_TEMPLATE);
    }
}
