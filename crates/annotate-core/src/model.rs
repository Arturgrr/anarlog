// The annotation bundle's manifest and its parts. Ported from Hex (MIT, © 2026 Christopher
// Langton) at `3dc7f538`: `crates/router/src/model.rs`, without the router, app context, phone
// and input-event fields Librelog does not record.

use serde::{Deserialize, Serialize};

/// The manifest's file name. It is written last: a folder with one is complete.
pub const MANIFEST: &str = "annotation.json";
/// The manifest format this crate writes.
pub const VERSION: u32 = 1;
pub const VIDEO_FILE: &str = "recording.mp4";
pub const AUDIO_FILE: &str = "audio.wav";
pub const SUMMARY_FILE: &str = "summary.md";
pub const CONTACT_SHEET_FILE: &str = "contact-sheet.png";
pub const FRAMES_DIR: &str = "frames";

/// Coordinates in `Stroke::pts` are scaled to `0..=10_000` (1/10000 of the display's width/height).
pub const SCALE: i32 = 10_000;

/// Pause longer than this (ms) between strokes starts a new `Mark`.
pub const MARK_GAP_MS: u64 = 1_200;

/// Maximum strokes grouped into a single `Mark`.
pub const MAX_MARK_STROKES: usize = 6;

/// Keyframes any annotation may fill from ordinary events.
pub const BASE_KEYFRAMES: usize = 6;

/// Maximum keyframes selected for a contact sheet.
pub const MAX_KEYFRAMES: usize = 12;

/// Keyframes an annotation of this length may use: `BASE_KEYFRAMES` up to 40 s, then one more
/// per 20 s, up to `MAX_KEYFRAMES` at 2:20. Each image costs a reading model ~1–1.5k tokens.
pub fn keyframe_budget(duration_ms: u64) -> usize {
    (BASE_KEYFRAMES + duration_ms.saturating_sub(20_000) as usize / 20_000).min(MAX_KEYFRAMES)
}

/// Formats milliseconds as `M:SS` (e.g. `0:04`, `1:23`).
pub fn format_clock(ms: u64) -> String {
    let total_seconds = ms / 1_000;
    format!("{}:{:02}", total_seconds / 60, total_seconds % 60)
}

/// `annotation.json`. Every time in it is in milliseconds from the start of the capture.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub version: u32,
    pub id: String,
    pub created_at_ms: u64,
    pub duration_ms: u64,
    pub target: Target,
    pub transcript: Transcript,
    pub strokes: Vec<Stroke>,
    pub marks: Vec<Mark>,
    pub keyframes: Vec<Keyframe>,
    pub contact_sheet: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video: Option<String>,
    /// When the video starts on the annotation's clock: video time = annotation time − this.
    #[serde(default)]
    pub video_offset_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio: Option<String>,
}

/// The display that was recorded.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    /// Size in points.
    pub width: f64,
    pub height: f64,
    /// Pixels per point.
    pub scale: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_title: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub text: String,
    #[serde(default)]
    pub words: Vec<Word>,
    /// Recognizer segments, when it gives them: they start clauses, and stand in for the words
    /// when there are none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub segments: Vec<Segment>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Word {
    pub t0: u64,
    pub t1: u64,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Segment {
    pub t0: u64,
    pub t1: u64,
    pub text: String,
}

/// One pen-down to pen-up of ink.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Stroke {
    pub t0: u64,
    pub t1: u64,
    /// The display's size in points, which shapes are measured in.
    pub fw: u32,
    pub fh: u32,
    /// Flat triples `[x, y, dt_ms, ...]` where `x, y` are in `0..=SCALE` and `dt_ms` is ms since `t0`.
    pub pts: Vec<i32>,
}

impl Stroke {
    /// A stroke from pointer samples `(x, y, t_ms)`: `x, y` in points from the display's top-left
    /// corner, `t_ms` on the annotation clock, in drawing order. `width` and `height` are the
    /// display's size in points. Points off the display are clamped to its edge. `None` without
    /// points or with an empty display.
    pub fn from_points(points: &[(f64, f64, u64)], width: f64, height: f64) -> Option<Self> {
        if !(width >= 1.0 && height >= 1.0) {
            return None;
        }
        let &(_, _, t0) = points.first()?;
        let norm = |v: f64, size: f64| {
            let v = if v.is_finite() { v } else { 0.0 };
            ((v / size).clamp(0.0, 1.0) * SCALE as f64).round() as i32
        };
        let mut t1 = t0;
        let mut pts = Vec::with_capacity(points.len() * 3);
        for &(x, y, t) in points {
            let t = t.max(t1);
            t1 = t;
            let dt = i32::try_from(t - t0).unwrap_or(i32::MAX);
            pts.extend_from_slice(&[norm(x, width), norm(y, height), dt]);
        }
        Some(Self {
            t0,
            t1,
            fw: width.round() as u32,
            fh: height.round() as u32,
            pts,
        })
    }

    /// Returns normalized `(x, y)` points in `0.0..=1.0`.
    pub fn normalized_points(&self) -> Vec<[f32; 2]> {
        self.pts
            .chunks_exact(3)
            .map(|c| [c[0] as f32 / SCALE as f32, c[1] as f32 / SCALE as f32])
            .collect()
    }

    /// Returns `(x, y, absolute_t_ms)` points.
    pub fn timed_points(&self) -> Vec<(f32, f32, u64)> {
        self.pts
            .chunks_exact(3)
            .map(|c| {
                (
                    c[0] as f32 / SCALE as f32,
                    c[1] as f32 / SCALE as f32,
                    self.t0.saturating_add(c[2].max(0) as u64),
                )
            })
            .collect()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Shape {
    Circle,
    Underline,
    Line,
    Arrow,
    /// A dot too small to have a shape.
    Dot,
    Mark,
}

/// Strokes drawn close together in time, read as one gesture.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mark {
    pub id: String,
    /// Indices into `Annotation::strokes`.
    pub strokes: Vec<usize>,
    pub t0: u64,
    pub t1: u64,
    /// Normalized bounding box `[x0, y0, x1, y1]` in `0.0..=1.0`.
    pub box_norm: [f32; 4],
    pub shape: Shape,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<[f32; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<[f32; 2]>,
    pub description: String,
    /// The keyframe file that shows this mark.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyframeReason {
    Mark,
    SceneChange,
    Speech,
    Initial,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keyframe {
    /// 1-based; the number drawn on the frame.
    pub index: usize,
    pub t: u64,
    pub reason: KeyframeReason,
    /// Relative to the bundle folder, e.g. `frames/frame-01.png`.
    pub file: String,
    /// Why it was chosen, in words (the marks' descriptions, "scene changed"…).
    pub event: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub said: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mark_id: Option<String>,
}

/// An 8-bit RGBA image, row-major from the top-left, with straight (not premultiplied) alpha.
#[derive(Clone, Debug)]
pub struct RgbaFrame {
    /// When it was on screen, on the annotation clock.
    pub t_ms: u64,
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub(crate) badge_top_right: bool,
}

impl RgbaFrame {
    /// `rgba` must hold `width × height × 4` bytes; [`crate::encode_png`] refuses one that doesn't.
    pub fn new(t_ms: u64, width: u32, height: u32, rgba: Vec<u8>) -> Self {
        debug_assert_eq!(rgba.len(), (width as usize) * (height as usize) * 4);
        Self {
            t_ms,
            width,
            height,
            rgba,
            badge_top_right: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_manifest_round_trips_and_names_its_fields_in_camel_case() {
        let annotation = Annotation {
            version: VERSION,
            id: "annotation-1".into(),
            created_at_ms: 1_700_000_000_000,
            duration_ms: 12_000,
            target: Target {
                width: 1512.0,
                height: 982.0,
                scale: 2.0,
                app: Some("Safari".into()),
                window_title: None,
            },
            transcript: Transcript {
                source: "librelog".into(),
                model: Some("parakeet".into()),
                text: "Look here.".into(),
                words: vec![Word {
                    t0: 100,
                    t1: 400,
                    text: "Look".into(),
                }],
                segments: Vec::new(),
            },
            strokes: vec![
                Stroke::from_points(&[(10.0, 20.0, 50), (30.0, 40.0, 90)], 100.0, 100.0).unwrap(),
            ],
            marks: Vec::new(),
            keyframes: vec![Keyframe {
                index: 1,
                t: 500,
                reason: KeyframeReason::SceneChange,
                file: "frames/frame-01.png".into(),
                event: "scene changed".into(),
                said: Some("Look here.".into()),
                mark_id: None,
            }],
            contact_sheet: CONTACT_SHEET_FILE.into(),
            video: Some(VIDEO_FILE.into()),
            video_offset_ms: 40,
            audio: None,
        };
        let json = serde_json::to_value(&annotation).unwrap();
        assert_eq!(json["createdAtMs"], 1_700_000_000_000_u64);
        assert_eq!(json["videoOffsetMs"], 40);
        assert_eq!(json["target"]["app"], "Safari");
        assert_eq!(json["keyframes"][0]["reason"], "scene_change");
        assert!(json.get("audio").is_none());
        let back: Annotation = serde_json::from_value(json).unwrap();
        assert_eq!(back, annotation);
    }

    #[test]
    fn pointer_samples_become_normalized_triples() {
        let stroke = Stroke::from_points(
            &[
                (0.0, 0.0, 1_000),
                (750.0, 250.0, 1_016),
                (1_200.0, -5.0, 1_010),
            ],
            1_000.0,
            500.0,
        )
        .unwrap();
        assert_eq!(
            (stroke.t0, stroke.t1, stroke.fw, stroke.fh),
            (1_000, 1_016, 1_000, 500)
        );
        // Off-display points are clamped; a sample out of order keeps time moving forward.
        assert_eq!(stroke.pts, [0, 0, 0, 7_500, 5_000, 16, 10_000, 0, 16]);
        assert!(Stroke::from_points(&[], 100.0, 100.0).is_none());
        assert!(Stroke::from_points(&[(1.0, 1.0, 0)], 0.0, 100.0).is_none());
    }

    #[test]
    fn the_budget_grows_with_duration() {
        let budget: Vec<_> = [8_000, 39_999, 40_000, 67_600, 140_000, 268_000]
            .map(keyframe_budget)
            .into();
        assert_eq!(budget, [6, 6, 7, 8, 12, 12]);
    }
}
