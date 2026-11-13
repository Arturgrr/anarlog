// `summary.md`, the text that goes to the clipboard with the contact sheet. Ported from Hex (MIT,
// © 2026 Christopher Langton) at `3dc7f538`: `summary_markdown_with` in
// `crates/capture/src/sketch.rs` (its default format, without the phone, app-context, routing
// and crop lines); the lines naming each keyframe's marks are Librelog's.

use std::path::Path;

use crate::model::*;
use crate::sketch::marks_on;

/// Agents given only the text fix what was said and skip the pictures, missing what only shows
/// there.
pub const LOOK_AT_IMAGES: &str = "Open contact-sheet.png and frames/ in that folder before changing anything: the marks and words only make sense on the images, which can show more than the text does.";

/// The summary of `annotation`, whose bundle is at `bundle_dir`:
///
/// ```text
/// [annotation 0:14 · Safari “Checkout” · /path/to/annotation-…]
/// Open contact-sheet.png and frames/ in that folder before changing anything: …
/// - #1 (0:05) “This row is too dense.”
///   ✎ circled region x 0.30–0.41, y 0.25–0.32
/// - #2 (0:09) scene changed
/// ```
///
/// A keyframe with nothing said shows why it was chosen instead (its marks, a scene change…).
pub fn summary_markdown(annotation: &Annotation, bundle_dir: &Path) -> String {
    let mut target = annotation
        .target
        .app
        .clone()
        .unwrap_or_else(|| "Display".into());
    if let Some(title) = &annotation.target.window_title
        && !title.is_empty()
        && Some(title.as_str()) != annotation.target.app.as_deref()
    {
        target.push_str(&format!(" “{title}”"));
    }
    let mut out = format!(
        "[annotation {} · {target} · {}]\n",
        format_clock(annotation.duration_ms),
        bundle_dir.display()
    );
    if annotation.keyframes.is_empty() {
        let text = annotation.transcript.text.trim();
        if !text.is_empty() {
            out.push_str(&format!("“{text}”\n"));
        }
        return out;
    }
    out.push_str(LOOK_AT_IMAGES);
    out.push('\n');
    for frame in &annotation.keyframes {
        let clock = format_clock(frame.t);
        match frame
            .said
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(said) => {
                out.push_str(&format!("- #{} ({clock}) “{said}”\n", frame.index));
                for mark in marks_on(frame, &annotation.marks) {
                    out.push_str(&format!("  ✎ {}\n", mark.description));
                }
            }
            None => out.push_str(&format!("- #{} ({clock}) {}\n", frame.index, frame.event)),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sketch::marks_of;

    #[test]
    fn summary_lists_each_keyframe_with_its_words_or_marks() {
        let strokes = vec![
            Stroke::from_points(
                &[(500.0, 500.0, 5_000), (502.0, 501.0, 5_050)],
                1000.0,
                1000.0,
            )
            .unwrap(),
        ];
        let mut marks = marks_of(&strokes);
        marks[0].frame = Some("frames/frame-01.png".into());
        let keyframe = |index: usize, t: u64, said: Option<&str>, event: &str| Keyframe {
            index,
            t,
            reason: KeyframeReason::Mark,
            file: format!("frames/frame-{index:02}.png"),
            event: event.into(),
            said: said.map(Into::into),
            mark_id: None,
        };
        let mut annotation = Annotation {
            version: VERSION,
            id: "annotation-1".into(),
            created_at_ms: 0,
            duration_ms: 14_000,
            target: Target {
                width: 1000.0,
                height: 1000.0,
                scale: 2.0,
                app: Some("App".into()),
                window_title: Some("Window".into()),
            },
            transcript: Transcript {
                text: "This row is too dense.".into(),
                ..Default::default()
            },
            strokes,
            marks,
            keyframes: vec![
                keyframe(
                    1,
                    5_100,
                    Some("This row is too dense."),
                    "dotted x 0.50, y 0.50",
                ),
                keyframe(2, 9_000, None, "scene changed"),
            ],
            contact_sheet: CONTACT_SHEET_FILE.into(),
            video: None,
            video_offset_ms: 0,
            audio: None,
        };
        let dir = Path::new("/annotations/annotation-1");
        assert_eq!(
            summary_markdown(&annotation, dir),
            format!(
                "[annotation 0:14 · App “Window” · /annotations/annotation-1]\n\
                 {LOOK_AT_IMAGES}\n\
                 - #1 (0:05) “This row is too dense.”\n\
                 \x20 ✎ dotted x 0.50, y 0.50\n\
                 - #2 (0:09) scene changed\n"
            )
        );

        // Without pictures there is nothing to open: the words stand alone.
        annotation.keyframes.clear();
        annotation.target.app = None;
        assert_eq!(
            summary_markdown(&annotation, dir),
            "[annotation 0:14 · Display “Window” · /annotations/annotation-1]\n\
             “This row is too dense.”\n"
        );
    }
}
