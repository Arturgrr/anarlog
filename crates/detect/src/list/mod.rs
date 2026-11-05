#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "linux")]
pub use linux::*;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "windows")]
pub use windows::*;

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
pub fn list_installed_apps() -> Vec<InstalledApp> {
    Vec::new()
}

const SELF_BUNDLE_IDS: &[&str] = &[
    "com.arturgrr.librelog",
    "com.arturgrr.librelog.dev",
    "com.arturgrr.librelog.staging",
    "com.arturgrr.librelog.nightly",
    "com.arturgrr.librelog.desktop",
    "io.github.arturgrr.librelog",
];

const SELF_APP_NAMES: &[&str] = &[
    "librelog",
    "librelog dev",
    "librelog staging",
    "librelog nightly",
];

const SELF_APP_PATH_SEGMENTS: &[&str] = &[
    "/librelog.app/",
    "/librelog dev.app/",
    "/librelog staging.app/",
    "/librelog nightly.app/",
];

fn is_self_app(app: &InstalledApp) -> bool {
    let id = app.id.to_lowercase();
    let name = app.name.to_lowercase();

    SELF_BUNDLE_IDS.contains(&id.as_str())
        || SELF_APP_NAMES.contains(&name.as_str())
        || SELF_APP_PATH_SEGMENTS
            .iter()
            .any(|segment| id.contains(segment))
}

pub fn list_mic_using_apps() -> Result<Vec<InstalledApp>, crate::Error> {
    let apps = {
        #[cfg(target_os = "macos")]
        {
            macos::list_mic_using_apps()?
        }
        #[cfg(target_os = "linux")]
        {
            linux::list_mic_using_apps()?
        }
        #[cfg(target_os = "windows")]
        {
            windows::list_mic_using_apps()?
        }

        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        {
            Vec::<InstalledApp>::new()
        }
    };

    Ok(apps.into_iter().filter(|app| !is_self_app(app)).collect())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct InstalledApp {
    pub id: String,
    pub name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(id: &str, name: &str) -> InstalledApp {
        InstalledApp {
            id: id.to_string(),
            name: name.to_string(),
        }
    }

    #[test]
    fn is_self_app_matches_only_librelog_identities() {
        for (id, name, expected) in [
            ("com.arturgrr.librelog", "Librelog", true),
            ("pid:42", "Librelog", true),
            ("pid:43", "Librelog Nightly", true),
            (
                "/Applications/Librelog.app/Contents/MacOS/librelog",
                "Unknown",
                true,
            ),
            ("com.hyprnote.stable", "Anarlog", false),
            ("com.adobe.character-animator", "Character Animator", false),
            (
                "/Applications/Chart.app/Contents/MacOS/Chart",
                "Chart",
                false,
            ),
        ] {
            assert_eq!(
                is_self_app(&app(id, name)),
                expected,
                "is_self_app({id:?}, {name:?})"
            );
        }
    }
}
