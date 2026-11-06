use tauri::{AppHandle, Url};
use tauri_plugin_misc::MiscPluginExt;

// Keep these in sync with apps/desktop/src/settings/general/feedback.ts and the
// field ids in .github/ISSUE_TEMPLATE.
const NEW_ISSUE_URL: &str = "https://github.com/Arturgrr/librelog/issues/new";
pub const BUG_REPORT_TEMPLATE: &str = "bug_report.yml";
pub const FEEDBACK_TEMPLATE: &str = "feedback.yml";

/// Builds a GitHub issue form URL that pre-fills only the app version, macOS
/// version, and chip. Nothing is sent until the user submits the form.
fn issue_url(template: &str, app_version: &str, os_version: &str, arch: &str) -> Url {
    let chip = match arch {
        "aarch64" => "Apple silicon (arm64 build)".to_string(),
        "x86_64" => "Intel (x86_64 build)".to_string(),
        other => format!("{other} build"),
    };
    Url::parse_with_params(
        NEW_ISSUE_URL,
        [
            ("template", template),
            ("version", app_version),
            ("macos", os_version),
            ("chip", chip.as_str()),
        ],
    )
    .expect("the issue URL is valid")
}

pub fn open_issue_form(app: &AppHandle<tauri::Wry>, template: &str) {
    let device = app.misc().get_device_info(None);
    let url = issue_url(
        template,
        &device.app_version,
        &device.os_version,
        &device.arch,
    );
    if let Err(error) = open::that(url.as_str()) {
        tracing::error!("failed_to_open_issue_form: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issue_form_prefills_version_os_and_chip_for_the_template() {
        let url = issue_url(
            BUG_REPORT_TEMPLATE,
            "0.1.0-beta.1",
            "macOS 15.5 Sequoia",
            "aarch64",
        );

        assert_eq!(
            url.as_str(),
            "https://github.com/Arturgrr/librelog/issues/new?template=bug_report.yml&version=0.1.0-beta.1&macos=macOS+15.5+Sequoia&chip=Apple+silicon+%28arm64+build%29",
        );
    }
}
