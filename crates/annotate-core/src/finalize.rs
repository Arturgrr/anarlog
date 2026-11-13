// Turning a finished recording into a bundle. The order of the steps, the fallback to candidate
// frames and the manifest published last follow Hex (MIT, © 2026 Christopher Langton) at
// `3dc7f538`: `build_bundle_from_parts` and `merge_full_keyframes` in
// `crates/capture/src/pipeline.rs`, `make_bundle_id` there, and `write_bundle_files` and
// `publish_manifest` in `crates/capture/src/capture.rs`.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::model::*;
use crate::{Error, io_at};

/// Full-resolution frames for the finalize step, so this crate never decodes video.
pub trait FrameSource {
    /// What was on screen at each of `times_ms` (annotation clock, ascending; subtract
    /// `video_offset_ms` for the movie's own time), as full-size RGBA frames, each with `t_ms`
    /// set to the time it answers (within 250 ms counts). A frame left out, say one that failed
    /// to decode, is replaced by its candidate frame.
    fn frames_at(&mut self, times_ms: &[u64]) -> Vec<RgbaFrame>;
}

impl<F: FnMut(&[u64]) -> Vec<RgbaFrame>> FrameSource for F {
    fn frames_at(&mut self, times_ms: &[u64]) -> Vec<RgbaFrame> {
        self(times_ms)
    }
}

/// What the recorder and the transcriber produced, besides the media files in the folder.
#[derive(Clone, Debug)]
pub struct Recording {
    pub created_at_ms: u64,
    pub duration_ms: u64,
    pub target: Target,
    pub transcript: Transcript,
    pub strokes: Vec<Stroke>,
    /// Small frames sampled while recording (see [`crate::select_keyframes`]).
    pub candidates: Vec<RgbaFrame>,
    pub video_offset_ms: u64,
}

/// A bundle written by [`finalize`].
#[derive(Clone, Debug)]
pub struct Finalized {
    pub annotation: Annotation,
    /// The contents of `summary.md`.
    pub summary: String,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// A fresh bundle folder name, `annotation-<epoch ms>-<pid>`, unique within the process.
/// [`crate::retention`] only touches folders named like this.
pub fn new_bundle_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNT: AtomicU64 = AtomicU64::new(0);
    let ms = now_ms();
    let pid = std::process::id();
    match COUNT.fetch_add(1, Ordering::Relaxed) {
        0 => format!("{BUNDLE_PREFIX}{ms}-{pid:x}"),
        n => format!("{BUNDLE_PREFIX}{ms}-{pid:x}-{n}"),
    }
}

pub const BUNDLE_PREFIX: &str = "annotation-";

/// Writes the bundle in `dir`, which already holds whatever of `recording.mp4` and `audio.wav`
/// was recorded: groups the strokes into marks, chooses the keyframes from the candidates, asks
/// `frames` for them at full size, draws the ink and numbers, and writes `frames/frame-NN.png`,
/// `contact-sheet.png`, `summary.md` and, last, `annotation.json`. Everything in `dir` ends up
/// owner-only (files 0600, folders 0700) on Unix. Nothing is published if a step fails, and a
/// later call may try again.
pub fn finalize(
    dir: &Path,
    recording: Recording,
    frames: &mut dyn FrameSource,
) -> Result<Finalized, Error> {
    let Recording {
        created_at_ms,
        duration_ms,
        target,
        transcript,
        mut strokes,
        candidates,
        video_offset_ms,
    } = recording;
    strokes.sort_by_key(|s| s.t0);
    let mut marks = crate::marks_of(&strokes);
    let keyframes = crate::select_keyframes(
        &candidates,
        &mut marks,
        &transcript,
        keyframe_budget(duration_ms),
    );
    let times: Vec<u64> = keyframes.iter().map(|k| k.t).collect();
    let full = if times.is_empty() {
        Vec::new()
    } else {
        frames.frames_at(&times)
    };
    let mut annotated = with_full_frames(&keyframes, full, &candidates);
    drop(candidates);
    for (keyframe, frame) in &mut annotated {
        crate::draw_ink(frame, keyframe, &strokes, &marks);
    }
    let sheet = crate::render_contact_sheet(&annotated);
    for (keyframe, frame) in &mut annotated {
        crate::draw_badge(frame, keyframe);
    }

    let present = |name: &str| dir.join(name).is_file().then(|| name.to_owned());
    let annotation = Annotation {
        version: VERSION,
        id: dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        created_at_ms,
        duration_ms,
        target,
        transcript,
        strokes,
        marks,
        keyframes,
        contact_sheet: CONTACT_SHEET_FILE.into(),
        video: present(VIDEO_FILE),
        video_offset_ms,
        audio: present(AUDIO_FILE),
    };
    let summary = crate::summary_markdown(&annotation, dir);

    let frames_dir = dir.join(FRAMES_DIR);
    std::fs::create_dir_all(&frames_dir).map_err(io_at(&frames_dir))?;
    std::thread::scope(|scope| -> Result<(), Error> {
        let workers: Vec<_> = annotated
            .iter()
            .map(|(keyframe, frame)| {
                scope.spawn(move || save_png(frame, &dir.join(&keyframe.file)))
            })
            .collect();
        save_png(&sheet, &dir.join(&annotation.contact_sheet))?;
        for worker in workers {
            worker.join().expect("PNG writer panicked")?;
        }
        Ok(())
    })?;
    write_private(&dir.join(SUMMARY_FILE), summary.as_bytes())?;
    restrict(dir)?;
    publish_manifest(dir, &annotation)?;
    Ok(Finalized {
        annotation,
        summary,
    })
}

/// Each keyframe with its full-size frame (matched by time, within 250 ms), else its candidate.
fn with_full_frames(
    keyframes: &[Keyframe],
    full: Vec<RgbaFrame>,
    candidates: &[RgbaFrame],
) -> Vec<(Keyframe, RgbaFrame)> {
    let mut pool: Vec<Option<RgbaFrame>> = full.into_iter().map(Some).collect();
    keyframes
        .iter()
        .filter_map(|key| {
            let best = pool
                .iter()
                .enumerate()
                .filter_map(|(i, f)| f.as_ref().map(|frame| (i, frame.t_ms.abs_diff(key.t))))
                .filter(|&(_, diff)| diff <= 250)
                .min_by_key(|&(_, diff)| diff)
                .map(|(i, _)| i);
            let frame = match best.and_then(|i| pool[i].take()) {
                Some(mut frame) => {
                    frame.t_ms = key.t;
                    frame
                }
                None => candidates.iter().find(|c| c.t_ms == key.t)?.clone(),
            };
            Some((key.clone(), frame))
        })
        .collect()
}

fn save_png(frame: &RgbaFrame, path: &Path) -> Result<(), Error> {
    write_private(path, &crate::encode_png(frame)?)
}

/// Creates or replaces `path` as an owner-only file.
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), Error> {
    use std::io::Write as _;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(path).map_err(io_at(path))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(io_at(path))?;
    }
    file.write_all(bytes).map_err(io_at(path))
}

/// Files 0600 and folders 0700 under `dir`, `dir` included.
fn restrict(dir: &Path) -> Result<(), Error> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let meta = std::fs::symlink_metadata(dir).map_err(io_at(dir))?;
        if meta.is_dir() {
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
                .map_err(io_at(dir))?;
            for entry in std::fs::read_dir(dir).map_err(io_at(dir))? {
                restrict(&entry.map_err(io_at(dir))?.path())?;
            }
        } else if meta.is_file() {
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o600))
                .map_err(io_at(dir))?;
        }
    }
    #[cfg(not(unix))]
    let _ = dir;
    Ok(())
}

/// Writes `annotation.json` through a temporary file renamed into place: the last step, which
/// marks the bundle complete.
fn publish_manifest(dir: &Path, annotation: &Annotation) -> Result<(), Error> {
    let bytes = serde_json::to_vec_pretty(annotation)?;
    let tmp = dir.join(format!(".{MANIFEST}.tmp"));
    write_private(&tmp, &bytes)?;
    let manifest = dir.join(MANIFEST);
    std::fs::rename(&tmp, &manifest).map_err(|error| {
        let _ = std::fs::remove_file(&tmp);
        io_at(&manifest)(error)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(t_ms: u64, width: u32, height: u32, gray: u8) -> RgbaFrame {
        RgbaFrame::new(
            t_ms,
            width,
            height,
            [gray, gray, gray, 255].repeat((width * height) as usize),
        )
    }

    fn recording() -> Recording {
        // A circle drawn at 2–3 s on a 1000×500 point display, while saying "look at this".
        let circle: Vec<_> = (0..=40)
            .map(|i| {
                let a = std::f64::consts::TAU * i as f64 / 40.0;
                (
                    500.0 + 120.0 * a.cos(),
                    250.0 + 80.0 * a.sin(),
                    2_000 + i * 25,
                )
            })
            .collect();
        Recording {
            created_at_ms: 1_700_000_000_000,
            duration_ms: 6_000,
            target: Target {
                width: 1000.0,
                height: 500.0,
                scale: 2.0,
                app: Some("Safari".into()),
                window_title: None,
            },
            transcript: Transcript {
                source: "test".into(),
                model: None,
                text: "Look at this.".into(),
                words: [(1_800, "Look"), (2_100, "at"), (2_400, "this.")]
                    .into_iter()
                    .map(|(t, text)| Word {
                        t0: t,
                        t1: t + 200,
                        text: text.into(),
                    })
                    .collect(),
                segments: Vec::new(),
            },
            strokes: vec![Stroke::from_points(&circle, 1000.0, 500.0).unwrap()],
            candidates: (0..=24).map(|i| solid(i * 250, 200, 100, 200)).collect(),
            video_offset_ms: 120,
        }
    }

    #[test]
    fn a_finished_recording_becomes_a_complete_owner_only_bundle() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join(new_bundle_id());
        std::fs::create_dir(&dir).unwrap();
        std::fs::write(dir.join(VIDEO_FILE), b"movie").unwrap();
        let mut asked = Vec::new();
        let mut source = |times: &[u64]| {
            asked.extend_from_slice(times);
            times.iter().map(|&t| solid(t, 800, 400, 200)).collect()
        };
        let done = finalize(&dir, recording(), &mut source).unwrap();

        let annotation = &done.annotation;
        assert_eq!(asked, [3_000]);
        assert_eq!(annotation.marks.len(), 1);
        assert_eq!(annotation.marks[0].shape, Shape::Circle);
        assert_eq!(annotation.keyframes.len(), 1);
        assert_eq!(annotation.keyframes[0].mark_id.as_deref(), Some("m1"));
        assert_eq!(
            annotation.keyframes[0].said.as_deref(),
            Some("Look at this.")
        );
        assert_eq!(annotation.video.as_deref(), Some(VIDEO_FILE));
        assert_eq!(annotation.audio, None);
        assert_eq!(annotation.video_offset_ms, 120);

        let on_disk: Annotation =
            serde_json::from_slice(&std::fs::read(dir.join(MANIFEST)).unwrap()).unwrap();
        assert_eq!(&on_disk, annotation);
        assert_eq!(
            std::fs::read_to_string(dir.join(SUMMARY_FILE)).unwrap(),
            done.summary
        );
        let frame =
            crate::decode_png(&std::fs::read(dir.join("frames/frame-01.png")).unwrap()).unwrap();
        assert_eq!((frame.width, frame.height), (800, 400));
        // The circle is drawn in red where it was, round the middle of the frame.
        let red = frame
            .rgba
            .chunks_exact(4)
            .filter(|p| p[0] == 255 && p[1] < 80)
            .count();
        assert!(red > 500, "{red} red pixels");
        assert!(dir.join(CONTACT_SHEET_FILE).is_file());
        assert!(!dir.join(format!(".{MANIFEST}.tmp")).exists());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&dir), 0o700);
            assert_eq!(mode(&dir.join(FRAMES_DIR)), 0o700);
            for name in [
                MANIFEST,
                SUMMARY_FILE,
                CONTACT_SHEET_FILE,
                VIDEO_FILE,
                "frames/frame-01.png",
            ] {
                assert_eq!(mode(&dir.join(name)), 0o600, "{name}");
            }
        }
    }

    #[test]
    fn missing_full_frames_fall_back_to_the_candidates() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("annotation-1");
        std::fs::create_dir(&dir).unwrap();
        let done = finalize(&dir, recording(), &mut |_: &[u64]| Vec::new()).unwrap();
        let frame =
            crate::decode_png(&std::fs::read(dir.join("frames/frame-01.png")).unwrap()).unwrap();
        assert_eq!((frame.width, frame.height), (200, 100));
        assert_eq!(done.annotation.id, "annotation-1");
    }

    #[test]
    fn a_failed_write_publishes_no_manifest() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("annotation-1");
        std::fs::create_dir(&dir).unwrap();
        // `frames` is a file, so no frame can be written.
        std::fs::write(dir.join(FRAMES_DIR), b"").unwrap();
        assert!(finalize(&dir, recording(), &mut |_: &[u64]| Vec::new()).is_err());
        assert!(!dir.join(MANIFEST).exists());
    }

    #[test]
    fn full_keyframes_match_by_time_and_preserve_partial_decodes() {
        let kf = |index: usize, t: u64| Keyframe {
            index,
            t,
            reason: KeyframeReason::SceneChange,
            file: format!("frames/frame-{index:02}.png"),
            event: "scene changed".into(),
            said: None,
            mark_id: None,
        };
        let keyframes = [kf(1, 1_000), kf(2, 2_000), kf(3, 3_000)];
        let candidates: Vec<_> = [1_000, 2_000, 3_000].map(|t| solid(t, 32, 32, 10)).into();
        // Frame at 2_000 failed to decode and frames arrived out of order (3_000 clamped to 2_999).
        let full = vec![solid(2_999, 160, 160, 200), solid(1_000, 160, 160, 200)];
        let merged = with_full_frames(&keyframes, full, &candidates);
        let got: Vec<_> = merged.iter().map(|(_, f)| (f.width, f.t_ms)).collect();
        assert_eq!(got, [(160, 1_000), (32, 2_000), (160, 3_000)]);
    }
}
