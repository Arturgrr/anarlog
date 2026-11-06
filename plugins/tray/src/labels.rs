use std::sync::RwLock;

// Menu and dialog text in the app language. The frontend owns the catalogs and
// sends these once its locale loads; English covers the window before that.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    /// Contains `{app}`, like the other `*_app` and `quit_completely_*` labels.
    pub open_app: String,
    pub start_meeting: String,
    pub settings: String,
    pub check_for_updates: String,
    pub downloading_update: String,
    pub restart_to_apply_update: String,
    pub hide: String,
    pub quit: String,
    pub quit_completely: String,
    pub quit_completely_title: String,
    pub quit_completely_message: String,
    pub quit_completely_confirm: String,
    pub cancel: String,
    pub about_app: String,
    pub copy: String,
    pub new_note: String,
    pub report_bug: String,
    pub suggest_feature: String,
    pub file_menu: String,
    pub edit_menu: String,
    pub view_menu: String,
    pub window_menu: String,
    pub help_menu: String,
    pub services: String,
    pub hide_app: String,
    pub hide_others: String,
    pub show_all: String,
    pub close_window: String,
    pub undo: String,
    pub redo: String,
    pub cut: String,
    pub paste: String,
    pub select_all: String,
    pub fullscreen: String,
    pub minimize: String,
    pub zoom: String,
    /// Contains `{version}`.
    pub update_available_message: String,
    pub update_available_title: String,
    pub download: String,
    pub later: String,
    pub update_failed_title: String,
    /// Contains `{error}`.
    pub install_failed_message: String,
    /// Contains `{error}`.
    pub download_failed_message: String,
    pub no_updates_message: String,
    pub update_check_failed_title: String,
    /// Contains `{error}`.
    pub check_failed_message: String,
}

impl Default for TrayLabels {
    fn default() -> Self {
        Self {
            open_app: "Open {app}".into(),
            start_meeting: "Start a new meeting".into(),
            settings: "Settings".into(),
            check_for_updates: "Check for Updates".into(),
            downloading_update: "Downloading...".into(),
            restart_to_apply_update: "Restart to Apply Update".into(),
            hide: "Hide".into(),
            quit: "Quit".into(),
            quit_completely: "Quit Completely…".into(),
            quit_completely_title: "Quit {app} Completely?".into(),
            quit_completely_message: "{app} will stop running in the background.".into(),
            quit_completely_confirm: "Quit Completely".into(),
            cancel: "Cancel".into(),
            about_app: "About {app}".into(),
            copy: "Copy".into(),
            new_note: "New Note".into(),
            report_bug: "Report Bug".into(),
            suggest_feature: "Suggest Feature".into(),
            file_menu: "File".into(),
            edit_menu: "Edit".into(),
            view_menu: "View".into(),
            window_menu: "Window".into(),
            help_menu: "Help".into(),
            services: "Services".into(),
            hide_app: "Hide {app}".into(),
            hide_others: "Hide Others".into(),
            show_all: "Show All".into(),
            close_window: "Close Window".into(),
            undo: "Undo".into(),
            redo: "Redo".into(),
            cut: "Cut".into(),
            paste: "Paste".into(),
            select_all: "Select All".into(),
            fullscreen: "Toggle Full Screen".into(),
            minimize: "Minimize".into(),
            zoom: "Zoom".into(),
            update_available_message: "Update v{version} is available!".into(),
            update_available_title: "Update Available".into(),
            download: "Download".into(),
            later: "Later".into(),
            update_failed_title: "Update Failed".into(),
            install_failed_message: "Failed to install update: {error}".into(),
            download_failed_message: "Failed to download update: {error}".into(),
            no_updates_message: "There are currently no updates available.".into(),
            update_check_failed_title: "Update Check Failed".into(),
            check_failed_message: "Failed to check for updates: {error}".into(),
        }
    }
}

static LABELS: RwLock<Option<TrayLabels>> = RwLock::new(None);

pub fn labels() -> TrayLabels {
    LABELS
        .read()
        .ok()
        .and_then(|labels| labels.clone())
        .unwrap_or_default()
}

/// Returns whether the labels changed.
pub(crate) fn set_labels(labels: TrayLabels) -> bool {
    let Ok(mut current) = LABELS.write() else {
        return false;
    };
    if current.as_ref() == Some(&labels) {
        return false;
    }
    *current = Some(labels);
    true
}

pub fn fill(template: &str, values: &[(&str, &str)]) -> String {
    values
        .iter()
        .fold(template.to_string(), |text, (key, value)| {
            text.replace(&format!("{{{key}}}"), value)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fill_replaces_named_placeholders_left_by_the_frontend() {
        assert_eq!(
            fill(
                "Atualização v{version} disponível!",
                &[("version", "1.2.3")]
            ),
            "Atualização v1.2.3 disponível!"
        );
    }
}
