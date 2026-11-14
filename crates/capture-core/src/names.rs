//! A capture's file name, as macOS names its own screenshots:
//! `Librelog Screenshot 2026-11-14 at 14.03.22.png`, then ` (2)`, ` (3)`…
//! when that name is taken. Adapted from Hex's `src/screenshots/save.rs`
//! (MIT, see THIRD_PARTY_NOTICES.md).

use std::path::{Path, PathBuf};

use chrono::{Datelike, Local, NaiveDateTime, TimeZone, Timelike};
use serde::{Deserialize, Serialize};

pub const SCREENSHOT_STEM: &str = "Librelog Screenshot";
pub const RECORDING_STEM: &str = "Librelog Recording";

/// Local wall-clock time, to the second.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stamp {
    pub year: i32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
}

impl Stamp {
    pub fn from_naive(at: NaiveDateTime) -> Self {
        Self {
            year: at.year(),
            month: at.month(),
            day: at.day(),
            hour: at.hour(),
            minute: at.minute(),
            second: at.second(),
        }
    }

    /// `ms` since the Unix epoch, in this computer's time zone.
    pub fn local(ms: i64) -> Self {
        let at = Local
            .timestamp_millis_opt(ms)
            .earliest()
            .map(|at| at.naive_local())
            .unwrap_or_default();
        Self::from_naive(at)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageFormat {
    Png,
    Jpeg,
}

impl ImageFormat {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
        }
    }

    /// From a file's extension; anything but `.jpg`/`.jpeg` is a PNG.
    pub fn of(path: &Path) -> Self {
        match path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("jpg" | "jpeg") => Self::Jpeg,
            _ => Self::Png,
        }
    }
}

/// `<stem> 2026-11-14 at 14.03.22.<extension>`, then ` (2)`, ` (3)`… for
/// `copy` past the first.
pub fn name_as(stem: &str, extension: &str, at: Stamp, copy: u32) -> String {
    name_with(stem, "", extension, at, copy)
}

fn name_with(stem: &str, suffix: &str, extension: &str, at: Stamp, copy: u32) -> String {
    let Stamp {
        year,
        month,
        day,
        hour,
        minute,
        second,
    } = at;
    let base = format!(
        "{stem} {year:04}-{month:02}-{day:02} at {hour:02}.{minute:02}.{second:02}{suffix}"
    );
    if copy <= 1 {
        format!("{base}.{extension}")
    } else {
        format!("{base} ({copy}).{extension}")
    }
}

/// A capture's file name, before the ` (2)`, ` (3)`… a clash adds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FileName {
    stem: &'static str,
    suffix: &'static str,
    extension: &'static str,
    at: Stamp,
}

impl FileName {
    pub fn screenshot(at: Stamp, format: ImageFormat) -> Self {
        Self {
            stem: SCREENSHOT_STEM,
            suffix: "",
            extension: format.extension(),
            at,
        }
    }

    /// `.gif` when `gif`, else `.mp4`.
    pub fn recording(at: Stamp, gif: bool) -> Self {
        Self {
            stem: RECORDING_STEM,
            suffix: "",
            extension: if gif { "gif" } else { "mp4" },
            at,
        }
    }

    /// A movie a quit or crash left unnamed: `… (recovered).mp4`.
    pub fn recovered(at: Stamp) -> Self {
        Self {
            suffix: " (recovered)",
            ..Self::recording(at, false)
        }
    }

    /// The name for the `copy`th capture with this name (1 is the first).
    pub fn nth(&self, copy: u32) -> String {
        name_with(self.stem, self.suffix, self.extension, self.at, copy)
    }
}

/// `file_name`, or with ` (copy)` before its extension past the first.
pub fn nth_like(file_name: &str, copy: u32) -> String {
    if copy <= 1 {
        return file_name.to_owned();
    }
    let name = Path::new(file_name);
    let stem = name
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    let extension = name
        .extension()
        .map(|extension| format!(".{}", extension.to_string_lossy()))
        .unwrap_or_default();
    format!("{stem} ({copy}){extension}")
}

/// A path in `folder` that no file holds yet, named as [`name_as`] names it.
pub fn free_path_as(folder: &Path, at: Stamp, stem: &str, extension: &str) -> PathBuf {
    (1..)
        .map(|copy| folder.join(name_as(stem, extension, at, copy)))
        .find(|path| !path.exists())
        .unwrap_or_else(|| folder.join(name_as(stem, extension, at, 1)))
}

pub fn screenshot_path(folder: &Path, at: Stamp, format: ImageFormat) -> PathBuf {
    free_path_as(folder, at, SCREENSHOT_STEM, format.extension())
}

/// `.gif` when `gif`, else `.mp4`.
pub fn recording_path(folder: &Path, at: Stamp, gif: bool) -> PathBuf {
    free_path_as(folder, at, RECORDING_STEM, if gif { "gif" } else { "mp4" })
}

/// `file_name` in `folder`, or with ` (2)`, ` (3)`… before its extension
/// when that is taken.
pub fn free_path_like(folder: &Path, file_name: &str) -> PathBuf {
    (1..)
        .map(|copy| folder.join(nth_like(file_name, copy)))
        .find(|path| !path.exists())
        .unwrap_or_else(|| folder.join(file_name))
}

#[cfg(test)]
mod tests {
    use super::*;

    const AT: Stamp = Stamp {
        year: 2026,
        month: 11,
        day: 4,
        hour: 14,
        minute: 3,
        second: 22,
    };

    #[test]
    fn captures_are_named_as_macos_names_its_screenshots() {
        assert_eq!(
            name_as(SCREENSHOT_STEM, "png", AT, 1),
            "Librelog Screenshot 2026-11-04 at 14.03.22.png"
        );
        assert_eq!(
            name_as(RECORDING_STEM, "mp4", AT, 2),
            "Librelog Recording 2026-11-04 at 14.03.22 (2).mp4"
        );
    }

    #[test]
    fn a_second_capture_in_the_same_second_gets_its_own_file() {
        let folder = tempfile::tempdir().unwrap();
        let first = screenshot_path(folder.path(), AT, ImageFormat::Jpeg);
        std::fs::write(&first, b"").unwrap();
        assert_eq!(
            screenshot_path(folder.path(), AT, ImageFormat::Jpeg),
            folder
                .path()
                .join("Librelog Screenshot 2026-11-04 at 14.03.22 (2).jpg")
        );

        let moved = free_path_like(folder.path(), &name_as(SCREENSHOT_STEM, "jpg", AT, 1));
        assert_eq!(
            moved.file_name().unwrap(),
            "Librelog Screenshot 2026-11-04 at 14.03.22 (2).jpg"
        );
    }
}
