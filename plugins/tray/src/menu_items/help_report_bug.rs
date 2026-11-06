use tauri::{
    AppHandle, Result,
    menu::{MenuItem, MenuItemKind},
};

use super::MenuItemHandler;

pub struct HelpReportBug;

impl MenuItemHandler for HelpReportBug {
    const ID: &'static str = "anlg_help_report_bug";

    fn build(app: &AppHandle<tauri::Wry>) -> Result<MenuItemKind<tauri::Wry>> {
        let item = MenuItem::with_id(
            app,
            Self::ID,
            crate::labels::labels().report_bug,
            true,
            None::<&str>,
        )?;
        Ok(MenuItemKind::MenuItem(item))
    }

    fn handle(app: &AppHandle<tauri::Wry>) {
        crate::feedback::open_issue_form(app, crate::feedback::BUG_REPORT_TEMPLATE);
    }
}
