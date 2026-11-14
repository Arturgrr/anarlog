//! Replacing and restoring macOS's screenshot shortcuts around a backup
//! file. One lock serializes every read, replace and restore in this
//! process, and the backup is only ever created, never written over, so a
//! second app sharing the folder (stable and Nightly) cannot replace it with
//! the shortcuts' already-off state. The `defaults` calls stay behind
//! [`Domain`], which the plugin implements on macOS.

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use plist::Value;

use crate::fs::{lock_exclusive, write_new_atomic};
use crate::hotkeys::{self, Error, Status, from_xml, to_xml};

/// The `com.apple.symbolichotkeys` preferences.
pub trait Domain {
    fn export(&self) -> Result<Value, Error>;
    fn import(&self, doc: &Value) -> Result<(), Error>;
    /// Applies an import without logging out; best effort.
    fn activate(&self);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Shortcuts {
    pub status: Status,
    /// A backup exists: Librelog turned them off.
    pub replaced: bool,
}

static LOCK: Mutex<()> = Mutex::new(());
const LOCK_FILE: &str = "system-shortcuts.lock";

enum Backup {
    Missing,
    Usable(Value),
    /// It could not be read and was renamed aside.
    SetAside,
}

fn usable(value: &Value) -> bool {
    let Some(backup) = value.as_dictionary() else {
        return false;
    };
    backup
        .get("entries")
        .and_then(Value::as_dictionary)
        .is_some()
        && backup.get("missing").and_then(Value::as_array).is_some()
}

fn load_backup(path: &Path) -> Result<Backup, Error> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Backup::Missing),
        Err(error) => return Err(error.into()),
    };
    match from_xml(&bytes) {
        Ok(value) if usable(&value) => Ok(Backup::Usable(value)),
        _ => {
            let millis = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |since| since.as_millis());
            let name = path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            let aside = path.with_file_name(format!("{name}.corrupt-{millis}"));
            std::fs::rename(path, &aside)?;
            Ok(Backup::SetAside)
        }
    }
}

fn read_unlocked(domain: &dyn Domain, backup_path: &Path) -> Result<Shortcuts, Error> {
    Ok(Shortcuts {
        status: hotkeys::status(&domain.export()?),
        replaced: backup_path.is_file(),
    })
}

/// Both locks: this process's, then the file lock another app sharing the
/// folder honours too.
fn lock(backup_path: &Path) -> Result<(MutexGuard<'static, ()>, std::fs::File), Error> {
    let guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(dir) = backup_path.parent() {
        crate::fs::ensure_private_dir(dir)?;
    }
    let file = lock_exclusive(&backup_path.with_file_name(LOCK_FILE))?;
    Ok((guard, file))
}

pub fn read(domain: &dyn Domain, backup_path: &Path) -> Result<Shortcuts, Error> {
    let _lock = lock(backup_path)?;
    read_unlocked(domain, backup_path)
}

/// Remembers the five shortcuts (unless a backup already does), turns them
/// off and reports what is on afterwards. With an unreadable backup, what is
/// remembered is "all on", so restoring turns them back on.
pub fn replace(domain: &dyn Domain, backup_path: &Path) -> Result<Shortcuts, Error> {
    let _lock = lock(backup_path)?;
    let doc = domain.export()?;
    let backup = match load_backup(backup_path)? {
        Backup::Usable(_) => None,
        Backup::Missing => Some(hotkeys::backup(&doc)?),
        Backup::SetAside => Some(hotkeys::backup(&hotkeys::enable(&doc)?)?),
    };
    let created = match backup {
        Some(backup) => write_new_atomic(backup_path, &to_xml(&backup)?, true)?,
        None => false,
    };
    let imported = hotkeys::disable(&doc).and_then(|off| domain.import(&off));
    if let Err(error) = imported {
        // Nothing was turned off: a backup this call made would say otherwise.
        if created {
            let _ = std::fs::remove_file(backup_path);
        }
        return Err(error);
    }
    domain.activate();
    read_unlocked(domain, backup_path)
}

/// Puts the five shortcuts back as remembered and forgets the backup.
/// Without a usable backup, any of them that is off is turned back on.
pub fn restore(domain: &dyn Domain, backup_path: &Path) -> Result<Shortcuts, Error> {
    let _lock = lock(backup_path)?;
    let doc = domain.export()?;
    match load_backup(backup_path)? {
        Backup::Usable(backup) => {
            domain.import(&hotkeys::restore(&doc, &backup)?)?;
            domain.activate();
            match std::fs::remove_file(backup_path) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                    return Err(error.into());
                }
                _ => {}
            }
        }
        Backup::Missing | Backup::SetAside => {
            if !hotkeys::all_on(&doc) {
                domain.import(&hotkeys::enable(&doc)?)?;
                domain.activate();
            }
        }
    }
    read_unlocked(domain, backup_path)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    /// The preferences in memory; `import` replaces the domain, as
    /// `defaults import` does.
    struct Memory(Mutex<Value>);

    impl Domain for Memory {
        fn export(&self) -> Result<Value, Error> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn import(&self, doc: &Value) -> Result<(), Error> {
            *self.0.lock().unwrap() = doc.clone();
            Ok(())
        }
        fn activate(&self) {}
    }

    fn original() -> Value {
        from_xml(
            br#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>AppleSymbolicHotKeys</key><dict>
<key>28</key><dict><key>enabled</key><true/><key>value</key><dict><key>parameters</key><array><integer>51</integer><integer>20</integer><integer>1179648</integer></array><key>type</key><string>standard</string></dict></dict>
<key>64</key><dict><key>enabled</key><false/></dict>
</dict></dict></plist>"#,
        )
        .unwrap()
    }

    #[test]
    fn replaces_and_restores_from_many_threads_never_lose_the_original() {
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join("backup.plist");
        let domain = Arc::new(Memory(Mutex::new(original())));
        let replaced = replace(domain.as_ref(), &backup).unwrap();
        assert!(replaced.replaced && !replaced.status.area && !replaced.status.fullscreen);
        replace(domain.as_ref(), &backup).unwrap();
        assert_eq!(
            from_xml(&std::fs::read(&backup).unwrap()).unwrap(),
            hotkeys::backup(&original()).unwrap()
        );

        let threads: Vec<_> = (0..8)
            .map(|n| {
                let (domain, backup) = (domain.clone(), backup.clone());
                std::thread::spawn(move || {
                    for _ in 0..10 {
                        if n % 2 == 0 {
                            replace(domain.as_ref(), &backup).unwrap();
                        } else {
                            restore(domain.as_ref(), &backup).unwrap();
                        }
                    }
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        let restored = restore(domain.as_ref(), &backup).unwrap();
        assert!(!restored.replaced);
        assert_eq!(domain.export().unwrap(), original());
    }

    #[test]
    fn an_unreadable_or_missing_backup_still_turns_the_shortcuts_back_on() {
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join("backup.plist");
        let domain = Memory(Mutex::new(hotkeys::disable(&original()).unwrap()));

        // Missing while they are off.
        let restored = restore(&domain, &backup).unwrap();
        assert!(restored.status.area && restored.status.fullscreen && !restored.replaced);
        assert!(hotkeys::all_on(&domain.export().unwrap()));

        // Unreadable: replace sets it aside and remembers "all on".
        std::fs::write(&backup, b"not a plist").unwrap();
        replace(&domain, &backup).unwrap();
        std::fs::write(&backup, b"not a plist either").unwrap();
        let restored = restore(&domain, &backup).unwrap();
        assert!(restored.status.options && !restored.replaced);
        assert!(hotkeys::all_on(&domain.export().unwrap()));
        let aside = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"))
            .count();
        assert_eq!(aside, 2);
    }

    #[test]
    fn a_failed_import_takes_back_the_backup_it_made() {
        struct Refusing(Value);
        impl Domain for Refusing {
            fn export(&self) -> Result<Value, Error> {
                Ok(self.0.clone())
            }
            fn import(&self, _: &Value) -> Result<(), Error> {
                Err(Error::Command("defaults failed".into()))
            }
            fn activate(&self) {}
        }
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join("backup.plist");
        assert!(replace(&Refusing(original()), &backup).is_err());
        assert!(!backup.exists());

        // One that was there before stays.
        std::fs::write(
            &backup,
            to_xml(&hotkeys::backup(&original()).unwrap()).unwrap(),
        )
        .unwrap();
        assert!(replace(&Refusing(original()), &backup).is_err());
        assert!(backup.exists());
    }
}
