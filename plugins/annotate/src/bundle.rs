//! A stopped recording to a finished bundle: the native stop result and the
//! transcript become an `anlg_annotate_core::Recording`, and the key frames come
//! from the movie through the native layer.

use std::path::Path;
use std::sync::Arc;

use anlg_annotate_core::{FrameSource, Recording, RgbaFrame, Stroke, Target, Transcript, Word};
use serde::{Deserialize, Serialize};

use crate::Error;
use crate::native::{ExtractReply, Native, StopResult};

/// What the transcriber heard, from the frontend. Times are ms from the
/// start of `audio.wav`, which is the capture's start.
#[derive(Clone, Debug, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptInput {
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    pub text: String,
    #[serde(default)]
    pub words: Vec<WordInput>,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WordInput {
    pub start_ms: u32,
    pub end_ms: u32,
    pub text: String,
}

/// The candidate frames' folder the native layer writes.
pub const CANDIDATES_DIR: &str = "candidates";
/// Where full-size frames are extracted while finalizing.
const EXTRACT_DIR: &str = ".extract";

fn ms(value: i64) -> u64 {
    value.max(0) as u64
}

fn transcript(input: Option<TranscriptInput>) -> Transcript {
    let Some(input) = input else {
        return Transcript {
            source: "none".into(),
            ..Transcript::default()
        };
    };
    let words: Vec<Word> = input
        .words
        .iter()
        .filter_map(|word| {
            let text = word.text.trim();
            (!text.is_empty()).then(|| Word {
                t0: u64::from(word.start_ms),
                t1: u64::from(word.end_ms.max(word.start_ms)),
                text: text.to_owned(),
            })
        })
        .collect();
    let text = match input.text.trim() {
        "" => words
            .iter()
            .map(|w| w.text.as_str())
            .collect::<Vec<_>>()
            .join(" "),
        text => text.to_owned(),
    };
    Transcript {
        source: input.provider.unwrap_or_else(|| "librelog".into()),
        model: input.model,
        text,
        words,
        segments: Vec::new(),
    }
}

/// The candidate JPEGs as frames; one that can't be read is left out.
fn candidates(result: &StopResult) -> Vec<RgbaFrame> {
    result
        .candidates
        .iter()
        .filter_map(|candidate| {
            let image = image::open(&candidate.path)
                .inspect_err(|error| {
                    tracing::warn!(%error, path = candidate.path, "unreadable candidate frame")
                })
                .ok()?
                .into_rgba8();
            let (width, height) = image.dimensions();
            Some(RgbaFrame::new(
                ms(candidate.t_ms),
                width,
                height,
                image.into_raw(),
            ))
        })
        .collect()
}

/// The native stop result and the transcript as the core's input.
pub fn recording(result: &StopResult, transcript_input: Option<TranscriptInput>) -> Recording {
    let display = &result.display;
    let strokes = result
        .strokes
        .iter()
        .filter_map(|stroke| {
            let points: Vec<_> = stroke
                .points
                .iter()
                .map(|p| (p.x, p.y, ms(p.t_ms)))
                .collect();
            Stroke::from_points(&points, display.width_pt, display.height_pt)
        })
        .collect();
    let non_empty = |value: &Option<String>| value.clone().filter(|v| !v.trim().is_empty());
    Recording {
        created_at_ms: ms(result.started_wall_ms),
        duration_ms: ms(result.duration_ms),
        target: Target {
            width: display.width_pt,
            height: display.height_pt,
            scale: if display.scale > 0.0 {
                display.scale
            } else {
                1.0
            },
            app: non_empty(&result.front_app.name),
            window_title: non_empty(&result.front_app.window_title),
        },
        transcript: transcript(transcript_input),
        strokes,
        candidates: candidates(result),
        video_offset_ms: ms(result.video_offset_ms.unwrap_or(0)),
    }
}

/// Full-size frames read from the movie by the native layer.
struct MovieFrames<'a> {
    native: &'a Arc<dyn Native>,
    video: &'a str,
    video_offset_ms: i64,
    dir: &'a Path,
}

impl FrameSource for MovieFrames<'_> {
    fn frames_at(&mut self, times_ms: &[u64]) -> Vec<RgbaFrame> {
        let request = serde_json::json!({
            "video": self.video,
            "video_offset_ms": self.video_offset_ms,
            "times_ms": times_ms,
            "dir": self.dir,
        });
        let reply = match self.native.extract_frames(&request.to_string()) {
            Ok(reply) => reply,
            Err(error) => {
                tracing::warn!(%error, "key frames fall back to the candidates");
                return Vec::new();
            }
        };
        let reply: ExtractReply = serde_json::from_str(&reply).unwrap_or_default();
        reply
            .frames
            .iter()
            .filter_map(|frame| {
                let bytes = std::fs::read(&frame.path).ok()?;
                let mut decoded = anlg_annotate_core::decode_png(&bytes).ok()?;
                decoded.t_ms = ms(frame.t_ms);
                Some(decoded)
            })
            .collect()
    }
}

/// What a finished annotation offers the frontend.
#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Finalized {
    pub id: String,
    pub dir: String,
    pub summary: String,
    pub contact_sheet: String,
}

/// Writes the bundle in `dir` and removes the candidates and extracted
/// frames. Without a transcript the bundle has no narration text.
pub fn finalize(
    native: &Arc<dyn Native>,
    dir: &Path,
    result: &StopResult,
    transcript: Option<TranscriptInput>,
) -> Result<Finalized, Error> {
    let extract = dir.join(EXTRACT_DIR);
    let mut frames = MovieFrames {
        native,
        video: &result.video_path,
        video_offset_ms: result.video_offset_ms.unwrap_or(0),
        dir: &extract,
    };
    let finalized = anlg_annotate_core::finalize(dir, recording(result, transcript), &mut frames);
    let _ = std::fs::remove_dir_all(&extract);
    let finalized = finalized?;
    let _ = std::fs::remove_dir_all(dir.join(CANDIDATES_DIR));
    Ok(Finalized {
        id: finalized.annotation.id.clone(),
        dir: dir.to_string_lossy().into_owned(),
        summary: finalized.summary,
        contact_sheet: dir
            .join(&finalized.annotation.contact_sheet)
            .to_string_lossy()
            .into_owned(),
    })
}

/// The newest complete bundle in `root`, with its summary.
pub fn latest(root: &Path) -> Result<Option<Finalized>, Error> {
    let Some(entry) = anlg_annotate_core::library::latest(root) else {
        return Ok(None);
    };
    let summary = std::fs::read_to_string(entry.dir.join(anlg_annotate_core::SUMMARY_FILE))?;
    Ok(Some(Finalized {
        id: entry.annotation.id.clone(),
        dir: entry.dir.to_string_lossy().into_owned(),
        summary,
        contact_sheet: entry
            .dir
            .join(&entry.annotation.contact_sheet)
            .to_string_lossy()
            .into_owned(),
    }))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A stop result as the native layer writes it, with `candidates` 480-px
    /// JPEGs in `dir/candidates`.
    pub fn stop_result(dir: &Path, candidates: usize) -> StopResult {
        serde_json::from_value(stop_json(dir, candidates)).unwrap()
    }

    pub fn stop_json(dir: &Path, candidates: usize) -> serde_json::Value {
        let folder = dir.join(CANDIDATES_DIR);
        std::fs::create_dir_all(&folder).unwrap();
        let mut list = Vec::new();
        for i in 0..candidates {
            let path = folder.join(format!("{:08}.jpg", i * 500));
            image::RgbImage::from_pixel(480, 300, image::Rgb([200, 200, 200]))
                .save(&path)
                .unwrap();
            list.push(serde_json::json!({ "t_ms": i * 500, "path": path }));
        }
        std::fs::write(dir.join("recording.mp4"), b"movie").unwrap();
        let circle: Vec<_> = (0..=40)
            .map(|i| {
                let a = std::f64::consts::TAU * f64::from(i) / 40.0;
                serde_json::json!({
                    "x": 700.0 + 100.0 * a.cos(), "y": 400.0 + 80.0 * a.sin(), "t_ms": 1_000 + i * 20
                })
            })
            .collect();
        serde_json::json!({
            "video_path": dir.join("recording.mp4"),
            "started_host_ticks": 1, "started_host_ns": 1, "started_wall_ms": 1_763_000_000_000_i64,
            "duration_ms": 4_000, "video_offset_ms": 33, "video_duration_ms": 3_960,
            "display": {"id": 1, "width_pt": 1512.0, "height_pt": 982.0, "scale": 2.0,
                        "width_px": 3024, "height_px": 1964, "video_width": 2560, "video_height": 1662},
            "front_app": {"name": "Terminal", "bundle_id": "com.apple.Terminal", "window_title": "zsh"},
            "candidates": list,
            "strokes": [{"mode": "hover", "t0_ms": 1_000, "t1_ms": 1_800, "points": circle}],
            "ended_by": "stop", "warnings": []
        })
    }

    #[test]
    fn the_native_stop_result_becomes_the_cores_recording() {
        let dir = tempfile::tempdir().unwrap();
        let result = stop_result(dir.path(), 3);
        let recording = recording(
            &result,
            Some(TranscriptInput {
                provider: Some("deepgram".into()),
                model: Some("nova-3".into()),
                text: String::new(),
                words: vec![
                    WordInput {
                        start_ms: 900,
                        end_ms: 1_100,
                        text: " Look".into(),
                    },
                    WordInput {
                        start_ms: 1_100,
                        end_ms: 1_300,
                        text: " here".into(),
                    },
                ],
            }),
        );
        assert_eq!(recording.created_at_ms, 1_763_000_000_000);
        assert_eq!(
            (recording.duration_ms, recording.video_offset_ms),
            (4_000, 33)
        );
        assert_eq!(recording.target.app.as_deref(), Some("Terminal"));
        assert_eq!(recording.target.window_title.as_deref(), Some("zsh"));
        assert_eq!(
            (recording.target.width, recording.target.scale),
            (1512.0, 2.0)
        );
        assert_eq!(recording.strokes.len(), 1);
        assert_eq!(
            (recording.strokes[0].t0, recording.strokes[0].t1),
            (1_000, 1_800)
        );
        assert_eq!(
            (recording.strokes[0].fw, recording.strokes[0].fh),
            (1512, 982)
        );
        let times: Vec<_> = recording.candidates.iter().map(|c| c.t_ms).collect();
        assert_eq!(times, [0, 500, 1_000]);
        assert_eq!(recording.candidates[0].width, 480);
        assert_eq!(recording.transcript.text, "Look here");
        assert_eq!(recording.transcript.source, "deepgram");
        assert_eq!(recording.transcript.words[1].t0, 1_100);
    }
}
