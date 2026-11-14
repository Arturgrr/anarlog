//! macOS's own screenshot shortcuts, in the `com.apple.symbolichotkeys`
//! preferences: ⌘⇧3 (28) and ⌃⌘⇧3 (29), ⌘⇧4 (30) and ⌃⌘⇧4 (31), ⌘⇧5 (184).
//! Each entry is `{ enabled; value = { parameters = (ascii, keycode,
//! modifiers); type = standard; } }`; a missing one is on, with its default.
//!
//! These functions take the whole exported domain and return the whole
//! domain to import, changing only those five entries. The shell that runs
//! `defaults` lives in the plugin, on macOS only.

use plist::{Dictionary, Value};

pub const DICTIONARY: &str = "AppleSymbolicHotKeys";
/// 28, 29, 30, 31 and 184.
pub const IDS: [u32; 5] = [28, 29, 30, 31, 184];
const FULLSCREEN: u32 = 28;
const AREA: u32 = 30;
const OPTIONS: u32 = 184;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("The macOS shortcut settings are not a dictionary.")]
    NotADictionary,
    #[error("The saved macOS shortcut settings cannot be read.")]
    BadBackup,
    #[error("Could not read the macOS shortcut settings: {0}")]
    Plist(#[from] plist::Error),
}

/// Which of macOS's screenshot shortcuts are on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Status {
    /// ⌘⇧4.
    pub area: bool,
    /// ⌘⇧3.
    pub fullscreen: bool,
    /// ⌘⇧5.
    pub options: bool,
}

fn default_parameters(id: u32) -> [i64; 3] {
    match id {
        28 => [51, 20, 1_179_648],
        29 => [51, 20, 1_441_792],
        30 => [52, 21, 1_179_648],
        31 => [52, 21, 1_441_792],
        _ => [53, 23, 1_179_648],
    }
}

fn default_entry(id: u32, enabled: bool) -> Value {
    let mut value = Dictionary::new();
    value.insert(
        "parameters".into(),
        Value::Array(
            default_parameters(id)
                .into_iter()
                .map(|n| Value::Integer(n.into()))
                .collect(),
        ),
    );
    value.insert("type".into(), Value::String("standard".into()));
    let mut entry = Dictionary::new();
    entry.insert("enabled".into(), Value::Boolean(enabled));
    entry.insert("value".into(), Value::Dictionary(value));
    Value::Dictionary(entry)
}

pub fn from_xml(bytes: &[u8]) -> Result<Value, Error> {
    Ok(Value::from_reader(std::io::Cursor::new(bytes))?)
}

pub fn to_xml(value: &Value) -> Result<Vec<u8>, Error> {
    let mut bytes = Vec::new();
    value.to_writer_xml(&mut bytes)?;
    Ok(bytes)
}

fn hotkeys(doc: &Value) -> Option<&Dictionary> {
    doc.as_dictionary()?.get(DICTIONARY)?.as_dictionary()
}

fn is_on(entry: Option<&Value>) -> bool {
    let Some(entry) = entry.and_then(Value::as_dictionary) else {
        return true;
    };
    match entry.get("enabled") {
        Some(Value::Boolean(on)) => *on,
        Some(Value::Integer(on)) => on.as_signed() != Some(0),
        _ => true,
    }
}

pub fn status(doc: &Value) -> Status {
    let on = |id: u32| is_on(hotkeys(doc).and_then(|keys| keys.get(&id.to_string())));
    Status {
        area: on(AREA),
        fullscreen: on(FULLSCREEN),
        options: on(OPTIONS),
    }
}

/// The five entries as found, to put back with [`restore`]: `{ had_dictionary,
/// entries = { "28" = …; }, missing = ("29", …) }`.
pub fn backup(doc: &Value) -> Result<Value, Error> {
    let root = doc.as_dictionary().ok_or(Error::NotADictionary)?;
    let found = root.get(DICTIONARY).and_then(Value::as_dictionary);
    let mut entries = Dictionary::new();
    let mut missing = Vec::new();
    for id in IDS {
        let key = id.to_string();
        match found.and_then(|keys| keys.get(&key)) {
            Some(entry) => {
                entries.insert(key, entry.clone());
            }
            None => missing.push(Value::String(key)),
        }
    }
    let mut backup = Dictionary::new();
    backup.insert("had_dictionary".into(), Value::Boolean(found.is_some()));
    backup.insert("entries".into(), Value::Dictionary(entries));
    backup.insert("missing".into(), Value::Array(missing));
    Ok(Value::Dictionary(backup))
}

/// `doc` with the five shortcuts off. A missing entry is created with its
/// default keys; an existing one keeps its keys.
pub fn disable(doc: &Value) -> Result<Value, Error> {
    let mut doc = doc.clone();
    let root = doc.as_dictionary_mut().ok_or(Error::NotADictionary)?;
    if !matches!(root.get(DICTIONARY), Some(Value::Dictionary(_))) {
        root.insert(DICTIONARY.into(), Value::Dictionary(Dictionary::new()));
    }
    let Some(Value::Dictionary(keys)) = root.get_mut(DICTIONARY) else {
        unreachable!()
    };
    for id in IDS {
        let key = id.to_string();
        match keys.get_mut(&key) {
            Some(Value::Dictionary(entry)) => {
                entry.insert("enabled".into(), Value::Boolean(false));
            }
            _ => {
                keys.insert(key, default_entry(id, false));
            }
        }
    }
    Ok(doc)
}

/// What replacing does: the shortcuts off, and the backup to keep. `kept` is
/// the backup already on disk, if any: it wins, so a second replace never
/// overwrites how things were before the first.
pub struct Replaced {
    pub doc: Value,
    pub backup: Value,
    /// The backup is new and must be written.
    pub new_backup: bool,
}

pub fn replace(doc: &Value, kept: Option<&Value>) -> Result<Replaced, Error> {
    let (backup, new_backup) = match kept {
        Some(kept) => (kept.clone(), false),
        None => (backup(doc)?, true),
    };
    Ok(Replaced {
        doc: disable(doc)?,
        backup,
        new_backup,
    })
}

/// `doc` with the five entries as `backup` remembers them: put back, or
/// removed when they were missing.
pub fn restore(doc: &Value, backup: &Value) -> Result<Value, Error> {
    let saved = backup.as_dictionary().ok_or(Error::BadBackup)?;
    let entries = saved
        .get("entries")
        .and_then(Value::as_dictionary)
        .ok_or(Error::BadBackup)?;
    let missing: Vec<&str> = saved
        .get("missing")
        .and_then(Value::as_array)
        .ok_or(Error::BadBackup)?
        .iter()
        .filter_map(Value::as_string)
        .collect();
    let had_dictionary = saved
        .get("had_dictionary")
        .and_then(Value::as_boolean)
        .unwrap_or(true);

    let mut doc = doc.clone();
    let root = doc.as_dictionary_mut().ok_or(Error::NotADictionary)?;
    if !matches!(root.get(DICTIONARY), Some(Value::Dictionary(_))) {
        root.insert(DICTIONARY.into(), Value::Dictionary(Dictionary::new()));
    }
    let Some(Value::Dictionary(keys)) = root.get_mut(DICTIONARY) else {
        unreachable!()
    };
    for id in IDS {
        let key = id.to_string();
        if let Some(entry) = entries.get(&key) {
            keys.insert(key, entry.clone());
        } else if missing.contains(&key.as_str()) {
            keys.remove(&key);
        }
    }
    if !had_dictionary && keys.is_empty() {
        root.remove(DICTIONARY);
    }
    Ok(doc)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An export with 28 off and its own keys, 30 on, 184 with an integer
    /// `enabled`, 29 and 31 missing, and unrelated entries and keys.
    const EXPORT: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>AppleSymbolicHotKeys</key>
  <dict>
    <key>28</key>
    <dict><key>enabled</key><false/><key>value</key><dict><key>parameters</key><array><integer>65535</integer><integer>99</integer><integer>1048576</integer></array><key>type</key><string>standard</string></dict></dict>
    <key>30</key>
    <dict><key>enabled</key><true/><key>value</key><dict><key>parameters</key><array><integer>52</integer><integer>21</integer><integer>1179648</integer></array><key>type</key><string>standard</string></dict></dict>
    <key>184</key>
    <dict><key>enabled</key><integer>1</integer><key>value</key><dict><key>parameters</key><array><integer>53</integer><integer>23</integer><integer>1179648</integer></array><key>type</key><string>standard</string></dict></dict>
    <key>64</key>
    <dict><key>enabled</key><true/><key>value</key><dict><key>parameters</key><array><integer>32</integer><integer>49</integer><integer>1048576</integer></array><key>type</key><string>standard</string></dict></dict>
  </dict>
  <key>OtherSetting</key>
  <string>kept</string>
</dict>
</plist>"#;

    fn export() -> Value {
        from_xml(EXPORT.as_bytes()).unwrap()
    }

    fn entry<'a>(doc: &'a Value, id: &str) -> Option<&'a Value> {
        hotkeys(doc).unwrap().get(id)
    }

    #[test]
    fn replacing_turns_off_only_the_five_and_creates_missing_ones_with_their_defaults() {
        let doc = export();
        assert_eq!(
            status(&doc),
            Status {
                area: true,
                fullscreen: false,
                options: true
            }
        );
        let replaced = replace(&doc, None).unwrap();
        assert!(replaced.new_backup);
        let off = &replaced.doc;
        assert_eq!(
            status(off),
            Status {
                area: false,
                fullscreen: false,
                options: false
            }
        );
        // Unrelated keys and entries are untouched.
        let root = off.as_dictionary().unwrap();
        assert_eq!(
            root.get("OtherSetting"),
            doc.as_dictionary().unwrap().get("OtherSetting")
        );
        assert_eq!(entry(off, "64"), entry(&doc, "64"));
        assert_eq!(hotkeys(off).unwrap().len(), 6);
        // 28 keeps its own keys; 29 is created with the default ones, off.
        let keys = |id: &str| {
            entry(off, id).unwrap().as_dictionary().unwrap()["value"]
                .as_dictionary()
                .unwrap()["parameters"]
                .clone()
        };
        assert_eq!(
            keys("28"),
            entry(&doc, "28").unwrap().as_dictionary().unwrap()["value"]
                .as_dictionary()
                .unwrap()["parameters"]
        );
        assert_eq!(
            keys("29"),
            default_entry(29, false).as_dictionary().unwrap()["value"]
                .as_dictionary()
                .unwrap()["parameters"]
        );
        assert!(!is_on(entry(off, "29")));
        // It survives the trip through `defaults import`'s XML.
        assert_eq!(&from_xml(&to_xml(off).unwrap()).unwrap(), off);
    }

    #[test]
    fn restoring_after_replacing_twice_returns_the_original_document() {
        let doc = export();
        let first = replace(&doc, None).unwrap();
        let saved = from_xml(&to_xml(&first.backup).unwrap()).unwrap();
        // A second replace while the backup exists keeps the first one.
        let second = replace(&first.doc, Some(&saved)).unwrap();
        assert!(!second.new_backup);
        assert_eq!(second.backup, first.backup);
        let restored = restore(&second.doc, &saved).unwrap();
        assert_eq!(restored, doc);
        assert!(entry(&restored, "29").is_none());

        // A domain that had no shortcuts dictionary at all comes back without one.
        let mut bare = Dictionary::new();
        bare.insert("OtherSetting".into(), Value::String("kept".into()));
        let bare = Value::Dictionary(bare);
        let replaced = replace(&bare, None).unwrap();
        assert!(!status(&replaced.doc).area);
        assert_eq!(restore(&replaced.doc, &replaced.backup).unwrap(), bare);
    }
}
