//! Turning macOS's own screenshot shortcuts off and back on: a thin shell
//! around `defaults` and `activateSettings` over the pure logic in
//! `anlg_capture_core::hotkeys`. Only macOS runs it.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use anlg_capture_core::Layout;
use anlg_capture_core::fs::{ensure_private_dir, write_atomic};
use anlg_capture_core::hotkeys::{self, from_xml, to_xml};

use crate::Error;
use crate::types::SystemShortcuts;

const DEFAULTS: &str = "/usr/bin/defaults";
const DOMAIN: &str = "com.apple.symbolichotkeys";
const ACTIVATE: &str =
    "/System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings";

fn available() -> Result<(), Error> {
    if cfg!(target_os = "macos") {
        Ok(())
    } else {
        Err(Error::ShortcutsUnavailable)
    }
}

/// The whole domain. A failed export is an error, never an empty domain:
/// importing that would wipe every other shortcut.
fn export() -> Result<plist::Value, Error> {
    let output = Command::new(DEFAULTS)
        .args(["export", DOMAIN, "-"])
        .output()?;
    if !output.status.success() {
        return Err(Error::Shortcuts(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    Ok(from_xml(&output.stdout)?)
}

fn import(doc: &plist::Value) -> Result<(), Error> {
    let xml = to_xml(doc)?;
    let mut child = Command::new(DEFAULTS)
        .args(["import", DOMAIN, "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(&xml)?;
    }
    let output = child.wait_with_output()?;
    if !output.status.success() {
        return Err(Error::Shortcuts(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    Ok(())
}

/// Applies the change without logging out; when it fails the change still
/// applies at the next login.
fn activate() {
    match Command::new(ACTIVATE).arg("-u").output() {
        Ok(output) if output.status.success() => {}
        Ok(output) => tracing::warn!(status = %output.status, "activateSettings"),
        Err(error) => tracing::warn!(%error, "activateSettings"),
    }
}

fn read_backup(path: &Path) -> Result<Option<plist::Value>, Error> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(from_xml(&bytes)?)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn status_of(doc: &plist::Value, layout: &Layout) -> SystemShortcuts {
    let status = hotkeys::status(doc);
    SystemShortcuts {
        area: status.area,
        fullscreen: status.fullscreen,
        options: status.options,
        replaced: layout.shortcuts_backup_path().is_file(),
    }
}

pub fn read(layout: &Layout) -> Result<SystemShortcuts, Error> {
    available()?;
    Ok(status_of(&export()?, layout))
}

/// Remembers the five shortcuts (unless a backup already does), turns them
/// off and reports what is on afterwards.
pub fn replace(layout: &Layout) -> Result<SystemShortcuts, Error> {
    available()?;
    let backup_path = layout.shortcuts_backup_path();
    let doc = export()?;
    let kept = read_backup(&backup_path)?;
    let replaced = hotkeys::replace(&doc, kept.as_ref())?;
    if replaced.new_backup {
        ensure_private_dir(layout.root())?;
        write_atomic(&backup_path, &to_xml(&replaced.backup)?, true)?;
    }
    import(&replaced.doc)?;
    activate();
    read(layout)
}

/// Puts the five shortcuts back as remembered and forgets the backup.
pub fn restore(layout: &Layout) -> Result<SystemShortcuts, Error> {
    available()?;
    let backup_path = layout.shortcuts_backup_path();
    let Some(backup) = read_backup(&backup_path)? else {
        return read(layout);
    };
    let doc = export()?;
    import(&hotkeys::restore(&doc, &backup)?)?;
    activate();
    std::fs::remove_file(&backup_path)?;
    read(layout)
}
