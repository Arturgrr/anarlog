//! Turning macOS's own screenshot shortcuts off and back on. The logic, the
//! lock and the backup are `anlg_capture_core::shortcuts`; this is the shell
//! around `defaults` and `activateSettings`, built only with the
//! `system-shortcuts` feature (the direct-distribution app, never the App
//! Store one) and run only on macOS.

use anlg_capture_core::Layout;
use anlg_capture_core::shortcuts::Shortcuts;

use crate::Error;
use crate::types::SystemShortcuts;

impl From<Shortcuts> for SystemShortcuts {
    fn from(shortcuts: Shortcuts) -> Self {
        Self {
            area: shortcuts.status.area,
            fullscreen: shortcuts.status.fullscreen,
            options: shortcuts.status.options,
            replaced: shortcuts.replaced,
        }
    }
}

#[cfg(feature = "system-shortcuts")]
mod defaults {
    use std::time::Duration;

    use anlg_capture_core::hotkeys::{Error, from_xml, to_xml};
    use anlg_capture_core::shortcuts::Domain;
    use plist::Value;

    use crate::process::run;

    const DEFAULTS: &str = "/usr/bin/defaults";
    const DOMAIN: &str = "com.apple.symbolichotkeys";
    const ACTIVATE: &str = "/System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings";
    const WITHIN: Duration = Duration::from_secs(10);

    pub struct Defaults;

    impl Domain for Defaults {
        /// A failed export is an error, never an empty domain: importing
        /// that would wipe every other shortcut.
        fn export(&self) -> Result<Value, Error> {
            from_xml(&run(DEFAULTS, &["export", DOMAIN, "-"], None, WITHIN)?)
        }

        fn import(&self, doc: &Value) -> Result<(), Error> {
            run(
                DEFAULTS,
                &["import", DOMAIN, "-"],
                Some(to_xml(doc)?),
                WITHIN,
            )
            .map(drop)
        }

        /// When it fails the change still applies at the next login.
        fn activate(&self) {
            if let Err(error) = run(ACTIVATE, &["-u"], None, WITHIN) {
                tracing::warn!(%error, "activateSettings");
            }
        }
    }
}

fn backup_path(layout: &Layout) -> std::path::PathBuf {
    layout.shortcuts_backup_path()
}

#[cfg(feature = "system-shortcuts")]
fn domain() -> Result<defaults::Defaults, Error> {
    if cfg!(target_os = "macos") {
        Ok(defaults::Defaults)
    } else {
        Err(Error::ShortcutsUnavailable)
    }
}

#[cfg(not(feature = "system-shortcuts"))]
fn domain() -> Result<NoDomain, Error> {
    Err(Error::ShortcutsUnavailable)
}

#[cfg(not(feature = "system-shortcuts"))]
enum NoDomain {}

#[cfg(not(feature = "system-shortcuts"))]
impl anlg_capture_core::shortcuts::Domain for NoDomain {
    fn export(&self) -> Result<plist::Value, anlg_capture_core::hotkeys::Error> {
        match *self {}
    }
    fn import(&self, _: &plist::Value) -> Result<(), anlg_capture_core::hotkeys::Error> {
        match *self {}
    }
    fn activate(&self) {
        match *self {}
    }
}

pub fn read(layout: &Layout) -> Result<SystemShortcuts, Error> {
    let domain = domain()?;
    Ok(anlg_capture_core::shortcuts::read(&domain, &backup_path(layout))?.into())
}

/// Remembers the five shortcuts (unless a backup already does), turns them
/// off and reports what is on afterwards.
pub fn replace(layout: &Layout) -> Result<SystemShortcuts, Error> {
    let domain = domain()?;
    anlg_capture_core::fs::ensure_private_dir(layout.root())?;
    Ok(anlg_capture_core::shortcuts::replace(&domain, &backup_path(layout))?.into())
}

/// Puts the five shortcuts back as remembered, or turns them back on when
/// nothing usable is remembered, and forgets the backup.
pub fn restore(layout: &Layout) -> Result<SystemShortcuts, Error> {
    let domain = domain()?;
    Ok(anlg_capture_core::shortcuts::restore(&domain, &backup_path(layout))?.into())
}
