//! Keeps the annotations folder from growing forever. Ported from Hex (MIT, © 2026 Christopher
//! Langton) at `3dc7f538`: `crates/capture/src/retention.rs`, with its presets and day rules, but
//! deleting instead of moving to the Trash (the host may pass its own remover) and without the
//! sync markers, claims and iPhone re-encoding.
//!
//! A bundle's prompt (`summary.md`, `annotation.json`, `contact-sheet.png`, `frames/`) is small;
//! its video and audio are nearly all of its size. After the policy's `media_days` the media goes
//! and the prompt stays; after `bundle_days` the whole bundle goes. A bundle younger than a day,
//! or whose folder changed within the last day, and a pinned one (`.pinned`) are never touched.
//! Only folders named like [`crate::new_bundle_id`] are considered.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::finalize::BUNDLE_PREFIX;
use crate::model::*;

/// Marks a bundle to keep forever.
pub const PINNED: &str = ".pinned";
/// The heavy files media cleanup removes.
pub const MEDIA: [&str; 2] = [VIDEO_FILE, AUDIO_FILE];

const DAY_MS: u64 = 24 * 60 * 60 * 1000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    /// Days to keep video and audio; `None` keeps them.
    pub media_days: Option<u32>,
    /// Days to keep the bundle itself; `None` keeps it.
    pub bundle_days: Option<u32>,
}

impl Default for Policy {
    fn default() -> Self {
        Preset::Week.policy()
    }
}

/// The choices offered in settings.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Preset {
    /// Media for 7 days, the bundle for 30.
    #[default]
    Week,
    /// Media for 30 days, the bundle for 90.
    Month,
    Forever,
}

impl Preset {
    pub fn policy(self) -> Policy {
        let (media_days, bundle_days) = match self {
            Self::Week => (Some(7), Some(30)),
            Self::Month => (Some(30), Some(90)),
            Self::Forever => (None, None),
        };
        Policy {
            media_days,
            bundle_days,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    Keep,
    DeleteMedia,
    DeleteBundle,
}

/// What `policy` does to a bundle created `age_ms` ago whose folder last changed `unchanged_ms`
/// ago. Nothing happens within a day of either, however short the policy.
pub fn decide(policy: &Policy, age_ms: u64, unchanged_ms: u64) -> Decision {
    if age_ms < DAY_MS || unchanged_ms < DAY_MS {
        return Decision::Keep;
    }
    let due = |days: Option<u32>| days.is_some_and(|d| age_ms >= u64::from(d.max(1)) * DAY_MS);
    if due(policy.bundle_days) {
        Decision::DeleteBundle
    } else if due(policy.media_days) {
        Decision::DeleteMedia
    } else {
        Decision::Keep
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Action {
    /// Delete these media files of the bundle.
    DeleteMedia {
        bundle: PathBuf,
        items: Vec<PathBuf>,
    },
    /// Delete the whole bundle folder.
    DeleteBundle(PathBuf),
}

fn ms_since(time: SystemTime, now: SystemTime) -> u64 {
    now.duration_since(time).unwrap_or_default().as_millis() as u64
}

/// When anything last changed in the folder itself (an entry added, removed or renamed): the
/// Unix change time, which copying can't backdate; elsewhere the modification time.
fn changed_at(dir: &Path) -> Option<SystemTime> {
    let meta = dir.metadata().ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Some(UNIX_EPOCH + Duration::new(meta.ctime().max(0) as u64, meta.ctime_nsec() as u32))
    }
    #[cfg(not(unix))]
    meta.modified().ok()
}

/// When the bundle was made: its manifest's `createdAtMs`, else the time in its name, else its
/// folder's modification time (an abandoned recording has no manifest).
fn created_at(dir: &Path, name: &str) -> Option<SystemTime> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Created {
        created_at_ms: u64,
    }
    let ms = std::fs::read(dir.join(MANIFEST))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Created>(&bytes).ok())
        .map(|c| c.created_at_ms)
        .or_else(|| {
            name.strip_prefix(BUNDLE_PREFIX)?
                .split('-')
                .next()?
                .parse()
                .ok()
        });
    match ms {
        Some(ms) => Some(UNIX_EPOCH + Duration::from_millis(ms)),
        None => dir.metadata().ok()?.modified().ok(),
    }
}

/// What one cleanup pass would do to the bundles in `root`, as of `now`.
pub fn plan(root: &Path, policy: &Policy, now: SystemTime) -> Vec<Action> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut bundles: Vec<(PathBuf, String)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| Some((e.path(), e.file_name().into_string().ok()?)))
        .filter(|(path, name)| name.starts_with(BUNDLE_PREFIX) && path.is_dir())
        .collect();
    bundles.sort();
    let mut actions = Vec::new();
    for (dir, name) in bundles {
        if dir.join(PINNED).exists() {
            continue;
        }
        let (Some(created), Some(changed)) = (created_at(&dir, &name), changed_at(&dir)) else {
            continue;
        };
        match decide(policy, ms_since(created, now), ms_since(changed, now)) {
            Decision::Keep => {}
            Decision::DeleteBundle => actions.push(Action::DeleteBundle(dir)),
            Decision::DeleteMedia => {
                let items: Vec<PathBuf> = MEDIA
                    .iter()
                    .map(|name| dir.join(name))
                    .filter(|p| p.exists())
                    .collect();
                if !items.is_empty() {
                    actions.push(Action::DeleteMedia { bundle: dir, items });
                }
            }
        }
    }
    actions
}

#[derive(Debug, Default)]
pub struct Report {
    pub media_deleted: usize,
    pub bundles_deleted: usize,
    /// Bytes removed.
    pub freed: u64,
    pub errors: Vec<(PathBuf, std::io::Error)>,
}

/// Deletes `path`, a file or a folder, for good.
pub fn remove(path: &Path) -> std::io::Result<()> {
    if std::fs::symlink_metadata(path)?.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
}

fn size_of(path: &Path) -> u64 {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return 0;
    };
    if meta.is_dir() {
        std::fs::read_dir(path)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .map(|e| size_of(&e.path()))
                    .sum()
            })
            .unwrap_or(0)
    } else {
        meta.len()
    }
}

/// Runs a plan with `remover` ([`remove`], or one that moves to the Trash). A bundle pinned
/// since the plan was made is skipped.
pub fn apply(actions: &[Action], remover: &dyn Fn(&Path) -> std::io::Result<()>) -> Report {
    let mut report = Report::default();
    for action in actions {
        match action {
            Action::DeleteMedia { bundle, items } => {
                if bundle.join(PINNED).exists() {
                    continue;
                }
                let mut deleted = false;
                for item in items {
                    let size = size_of(item);
                    match remover(item) {
                        Ok(()) => {
                            report.freed += size;
                            deleted = true;
                        }
                        Err(error) => report.errors.push((item.clone(), error)),
                    }
                }
                report.media_deleted += usize::from(deleted);
            }
            Action::DeleteBundle(bundle) => {
                if bundle.join(PINNED).exists() {
                    continue;
                }
                let size = size_of(bundle);
                match remover(bundle) {
                    Ok(()) => {
                        report.bundles_deleted += 1;
                        report.freed += size;
                    }
                    Err(error) => report.errors.push((bundle.clone(), error)),
                }
            }
        }
    }
    report
}

/// One cleanup pass over `root` with [`remove`].
pub fn run(root: &Path, policy: &Policy) -> Report {
    apply(&plan(root, policy, SystemTime::now()), &remove)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Plans run a little over a day ahead of the real clock, so folders made by the test count
    /// as unchanged for a day (their change time can't be backdated).
    fn later() -> SystemTime {
        SystemTime::now() + Duration::from_secs(25 * 3600)
    }

    /// A bundle created `days` before `later()`.
    fn bundle(root: &Path, n: u32, days: f64, manifest: bool) -> PathBuf {
        let created = later().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
            - (days * DAY_MS as f64) as u64;
        let dir = root.join(format!("{BUNDLE_PREFIX}{created}-{n}"));
        std::fs::create_dir_all(dir.join(FRAMES_DIR)).unwrap();
        if manifest {
            let json = serde_json::json!({ "version": 1, "createdAtMs": created });
            std::fs::write(dir.join(MANIFEST), json.to_string()).unwrap();
        }
        std::fs::write(dir.join(SUMMARY_FILE), "summary").unwrap();
        std::fs::write(dir.join(CONTACT_SHEET_FILE), "png").unwrap();
        std::fs::write(dir.join("frames/frame-01.png"), "png").unwrap();
        std::fs::write(dir.join(VIDEO_FILE), vec![0u8; 1000]).unwrap();
        std::fs::write(dir.join(AUDIO_FILE), vec![0u8; 100]).unwrap();
        dir
    }

    #[test]
    fn presets_keep_media_then_bundles_for_their_days() {
        let day = DAY_MS;
        let cases = [
            (Preset::Week, 0, Decision::Keep),
            (Preset::Week, 6 * day, Decision::Keep),
            (Preset::Week, 7 * day, Decision::DeleteMedia),
            (Preset::Week, 30 * day, Decision::DeleteBundle),
            (Preset::Month, 29 * day, Decision::Keep),
            (Preset::Month, 30 * day, Decision::DeleteMedia),
            (Preset::Month, 90 * day, Decision::DeleteBundle),
            (Preset::Forever, 3_650 * day, Decision::Keep),
        ];
        for (preset, age, want) in cases {
            assert_eq!(decide(&preset.policy(), age, age), want, "{preset:?} {age}");
        }
        // However short the policy, a bundle made or changed within a day is kept.
        let short = Policy {
            media_days: Some(0),
            bundle_days: Some(0),
        };
        assert_eq!(decide(&short, day - 1, 40 * day), Decision::Keep);
        assert_eq!(decide(&short, 40 * day, day - 1), Decision::Keep);
        assert_eq!(decide(&short, day, day), Decision::DeleteBundle);
    }

    #[test]
    fn a_pass_deletes_old_media_and_older_bundles_and_keeps_the_rest() {
        let root = tempfile::tempdir().unwrap();
        let root = root.path();
        let fresh = bundle(root, 1, 0.5, true);
        let week = bundle(root, 2, 3.0, true);
        let old = bundle(root, 3, 8.0, true);
        let ancient = bundle(root, 4, 31.0, true);
        let abandoned = bundle(root, 5, 31.0, false);
        let pinned = bundle(root, 6, 40.0, true);
        std::fs::write(pinned.join(PINNED), "").unwrap();
        let stranger = root.join("notes");
        std::fs::create_dir(&stranger).unwrap();

        let actions = plan(root, &Policy::default(), later());
        assert_eq!(
            actions,
            [
                Action::DeleteBundle(ancient.clone()),
                Action::DeleteBundle(abandoned.clone()),
                Action::DeleteMedia {
                    bundle: old.clone(),
                    items: vec![old.join(VIDEO_FILE), old.join(AUDIO_FILE)],
                },
            ]
        );
        assert!(plan(root, &Preset::Forever.policy(), later()).is_empty());

        let report = apply(&actions, &remove);
        assert_eq!((report.media_deleted, report.bundles_deleted), (1, 2));
        assert!(report.errors.is_empty());
        assert!(report.freed >= 3 * 1100);
        assert!(!ancient.exists() && !abandoned.exists());
        for kept in [
            MANIFEST,
            SUMMARY_FILE,
            CONTACT_SHEET_FILE,
            "frames/frame-01.png",
        ] {
            assert!(old.join(kept).is_file(), "{kept} kept");
        }
        assert!(!old.join(VIDEO_FILE).exists() && !old.join(AUDIO_FILE).exists());
        for dir in [&fresh, &week, &pinned, &stranger] {
            assert!(dir.is_dir(), "{} kept", dir.display());
        }
        assert!(fresh.join(VIDEO_FILE).exists() && week.join(VIDEO_FILE).exists());
    }
}
