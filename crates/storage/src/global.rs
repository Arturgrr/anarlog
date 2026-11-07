use std::path::{Path, PathBuf};

pub const VAULT_CONFIG_FILENAME: &str = "global.json";
const STAGING_BUNDLE_ID: &str = "com.arturgrr.librelog.staging";
const NIGHTLY_BUNDLE_ID: &str = "com.arturgrr.librelog.nightly";
const RELEASE_APP_FOLDER: &str = "librelog";

pub fn compute_vault_config_path(base: &Path) -> PathBuf {
    base.join(VAULT_CONFIG_FILENAME)
}

pub fn compute_default_base(bundle_id: &str) -> Option<PathBuf> {
    let data_dir = dirs::data_dir()?;
    let app_folder = resolve_app_folder(bundle_id, cfg!(debug_assertions));
    Some(data_dir.join(app_folder))
}

// This base holds settings, the store, and the vault config. Nightly keeps its
// own; the desktop app maps only the database itself onto stable's folder.
fn resolve_app_folder(bundle_id: &str, is_debug: bool) -> &str {
    if is_debug || matches!(bundle_id, STAGING_BUNDLE_ID | NIGHTLY_BUNDLE_ID) {
        bundle_id
    } else {
        RELEASE_APP_FOLDER
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_uses_the_librelog_folder() {
        assert_eq!(
            resolve_app_folder("com.arturgrr.librelog", false),
            RELEASE_APP_FOLDER
        );
    }

    #[test]
    fn nightly_and_staging_keep_their_own_settings_base() {
        assert_eq!(
            resolve_app_folder(NIGHTLY_BUNDLE_ID, false),
            NIGHTLY_BUNDLE_ID
        );
        assert_eq!(
            resolve_app_folder(STAGING_BUNDLE_ID, false),
            STAGING_BUNDLE_ID
        );
    }

    #[test]
    fn resolve_app_folder_returns_bundle_id_in_debug_builds() {
        assert_eq!(
            resolve_app_folder("com.arturgrr.librelog", true),
            "com.arturgrr.librelog"
        );
    }
}
