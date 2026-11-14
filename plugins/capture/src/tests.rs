use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anlg_annotate_macos::AnnotateError;
use anlg_capture_core::Layout;
use base64::Engine;

use crate::native::Native;
use crate::session::Session;
use crate::*;

/// The native layer as a script: it writes the files the real one would,
/// records what it was asked and hands out the queued events.
#[derive(Default)]
struct Fake {
    events: Mutex<Vec<String>>,
    calls: Mutex<Vec<String>>,
    movie: Mutex<Option<PathBuf>>,
    screenshot_delay: Mutex<Option<Duration>>,
    record_start_delay: Mutex<Option<Duration>>,
    copy_delay: Mutex<Option<Duration>>,
    gif_delay: Mutex<Option<Duration>>,
    fail_gif: AtomicBool,
    garbled_stop: AtomicBool,
    stop_delay: Mutex<Option<Duration>>,
    stop_error: AtomicBool,
    unavailable: AtomicBool,
}

fn wait(delay: &Mutex<Option<Duration>>) {
    if let Some(delay) = *delay.lock().unwrap() {
        std::thread::sleep(delay);
    }
}

fn field(request: &str, name: &str) -> serde_json::Value {
    serde_json::from_str::<serde_json::Value>(request).unwrap()[name].clone()
}

fn path_field(request: &str, name: &str) -> PathBuf {
    PathBuf::from(field(request, name).as_str().unwrap())
}

impl Fake {
    fn call(&self, call: String) {
        self.calls.lock().unwrap().push(call);
    }

    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }

    fn push(&self, event: &str) {
        self.events.lock().unwrap().push(event.into());
    }
}

impl Native for Fake {
    fn available(&self) -> bool {
        !self.unavailable.load(Ordering::SeqCst)
    }

    fn screenshot(&self, request: &str) -> Result<String, AnnotateError> {
        self.call("screenshot".into());
        wait(&self.screenshot_delay);
        let out = path_field(request, "out_path");
        image::RgbImage::from_pixel(40, 20, image::Rgb([200, 30, 30]))
            .save(&out)
            .unwrap();
        std::fs::write(path_field(request, "thumbnail_path"), b"png").unwrap();
        Ok(serde_json::json!({
            "status": "captured", "path": out, "thumbnail_path": field(request, "thumbnail_path"),
            "width_px": 40, "height_px": 20, "scale": 2.0, "kind": "area", "display_id": 1,
            "rect": {"x": 0, "y": 0, "width": 20, "height": 10}, "app": null, "window_title": null,
        })
        .to_string())
    }

    fn record_start(&self, request: &str) -> Result<String, AnnotateError> {
        wait(&self.record_start_delay);
        if self.calls().contains(&"record_cancel".to_string()) {
            return Ok(r#"{"status":"cancelled"}"#.into());
        }
        let out = path_field(request, "out_path");
        std::fs::write(&out, b"mp4").unwrap();
        *self.movie.lock().unwrap() = Some(out);
        Ok(r#"{"status":"recording","kind":"area","display_id":1,
            "rect":{"x":0,"y":0,"width":50,"height":25},"width_px":100,"height_px":50,"scale":2}"#
            .into())
    }

    fn record_stop(&self) -> Result<String, AnnotateError> {
        self.call("record_stop".into());
        wait(&self.stop_delay);
        if self.stop_error.load(Ordering::SeqCst) {
            return Err(AnnotateError {
                code: "timeout".into(),
                message: "the writer did not finish in time".into(),
            });
        }
        if self.garbled_stop.load(Ordering::SeqCst) {
            return Ok("[\"not what you asked for\"]".into());
        }
        let movie = self.movie.lock().unwrap().clone().unwrap();
        Ok(serde_json::json!({
            "video_path": movie, "duration_ms": 1500, "width_px": 100, "height_px": 50,
            "ended_by": "stop", "warnings": [],
        })
        .to_string())
    }

    fn record_cancel(&self) -> Result<(), AnnotateError> {
        if let Some(movie) = self.movie.lock().unwrap().take() {
            let _ = std::fs::remove_file(movie);
        }
        self.call("record_cancel".into());
        Ok(())
    }

    fn record_status(&self) -> Result<String, AnnotateError> {
        Ok(r#"{"phase":"recording","elapsed_ms":10}"#.into())
    }

    fn poll_events(&self) -> Result<String, AnnotateError> {
        let events = std::mem::take(&mut *self.events.lock().unwrap());
        Ok(format!("[{}]", events.join(",")))
    }

    fn make_gif(&self, request: &str) -> Result<String, AnnotateError> {
        assert_eq!(field(request, "max_frames"), 900);
        self.call(format!(
            "make_gif {}",
            field(request, "out_path").as_str().unwrap()
        ));
        let out = path_field(request, "out_path");
        std::fs::write(&out, b"GIF8").unwrap();
        wait(&self.gif_delay);
        if self.fail_gif.load(Ordering::SeqCst) {
            return Err(AnnotateError {
                code: "io".into(),
                message: "no frames".into(),
            });
        }
        std::fs::write(&out, b"GIF89a").unwrap();
        Ok(serde_json::json!({
            "path": out, "width_px": 72, "height_px": 36, "frames": 10, "fps": 15, "bytes": 6,
        })
        .to_string())
    }

    fn thumbnail(&self, request: &str) -> Result<String, AnnotateError> {
        std::fs::write(path_field(request, "out_path"), b"png").unwrap();
        Ok(r#"{"path":"","width_px":48,"height_px":24}"#.into())
    }

    fn copy(&self, request: &str) -> Result<(), AnnotateError> {
        wait(&self.copy_delay);
        self.call(format!("copy {}", field(request, "path").as_str().unwrap()));
        Ok(())
    }

    fn card_show(&self, request: &str) -> Result<(), AnnotateError> {
        self.call(format!(
            "card_show {} saved={}",
            field(request, "id").as_str().unwrap(),
            field(request, "saved")
        ));
        Ok(())
    }

    fn card_close(&self, _request: &str) -> Result<(), AnnotateError> {
        Ok(())
    }

    fn reveal(&self, path: &Path) -> Result<(), AnnotateError> {
        self.call(format!("reveal {}", path.display()));
        Ok(())
    }

    fn trash(&self, path: &Path) -> Result<(), AnnotateError> {
        std::fs::remove_file(path).unwrap();
        self.call(format!("trash {}", path.display()));
        Ok(())
    }
}

struct Harness {
    dir: tempfile::TempDir,
    session: Arc<Session>,
    fake: Arc<Fake>,
    events: Arc<Mutex<Vec<CaptureEvent>>>,
}

impl Harness {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let fake = Arc::new(Fake::default());
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let session = Arc::new(Session::new(
            fake.clone(),
            Layout::new(dir.path().join("captures")),
            Some(dir.path().join("Downloads")),
            Arc::new(move |event| sink.lock().unwrap().push(event)),
        ));
        Self {
            dir,
            session,
            fake,
            events,
        }
    }

    fn downloads(&self) -> PathBuf {
        self.dir.path().join("Downloads")
    }

    fn events(&self) -> Vec<CaptureEvent> {
        self.events.lock().unwrap().clone()
    }

    async fn until(&self, done: impl Fn(&[CaptureEvent]) -> bool) {
        tokio::time::timeout(Duration::from_secs(5), async {
            while !done(&self.events()) || self.session.status().phase != CapturePhase::Idle {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
    }

    async fn screenshot(&self, format: ImageFormat, save_dir: Option<&str>) -> CaptureEntry {
        match self.session.screenshot(screenshot(format, save_dir)).await {
            Ok(CaptureOutcome::Captured { entry }) => entry,
            other => panic!("{other:?}"),
        }
    }
}

fn screenshot(format: ImageFormat, save_dir: Option<&str>) -> ScreenshotRequest {
    ScreenshotRequest {
        mode: CaptureMode::Area,
        format,
        show_cursor: false,
        copy: true,
        save_dir: save_dir.map(Into::into),
        folder: None,
        show_card: true,
        labels: CaptureLabels::default(),
    }
}

fn recording(output: RecordingOutput, save_dir: Option<&str>) -> RecordingRequest {
    RecordingRequest {
        mode: CaptureMode::Area,
        output,
        fps: 30,
        show_cursor: true,
        microphone: false,
        system_audio: false,
        countdown_s: 0,
        gif_fps: 15,
        gif_max_width: 720,
        copy: false,
        save_dir: save_dir.map(Into::into),
        folder: None,
        show_card: false,
        labels: CaptureLabels::default(),
    }
}

fn png_base64(width: u32, height: u32) -> String {
    let mut png = std::io::Cursor::new(Vec::new());
    image::RgbaImage::from_pixel(width, height, image::Rgba([0, 0, 255, 255]))
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    base64::engine::general_purpose::STANDARD.encode(png.into_inner())
}

#[tokio::test(flavor = "multi_thread")]
async fn a_screenshot_is_saved_indexed_copied_and_shown_while_a_second_one_is_refused() {
    let h = Harness::new();
    *h.fake.screenshot_delay.lock().unwrap() = Some(Duration::from_millis(200));
    let first = tokio::spawn({
        let session = h.session.clone();
        async move { session.screenshot(screenshot(ImageFormat::Png, None)).await }
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(matches!(
        h.session
            .screenshot(screenshot(ImageFormat::Png, None))
            .await,
        Err(Error::Busy)
    ));
    let Ok(CaptureOutcome::Captured { entry }) = first.await.unwrap() else {
        panic!("not captured");
    };
    *h.fake.screenshot_delay.lock().unwrap() = None;

    assert!(entry.in_library);
    assert!(entry.path.ends_with(".png"));
    assert!(entry.path.contains("Librelog Screenshot "));
    assert!(Path::new(&entry.path).starts_with(h.dir.path().join("captures/files")));
    assert_eq!(
        (entry.width, entry.height, entry.kind),
        (40, 20, CaptureKind::Screenshot)
    );
    assert_eq!(
        h.session.list_captures().unwrap(),
        std::slice::from_ref(&entry)
    );
    assert_eq!(
        h.fake.calls(),
        [
            "screenshot".to_string(),
            format!("copy {}", entry.path),
            format!("card_show {} saved=false", entry.id)
        ]
    );
    assert_eq!(h.events(), [CaptureEvent::Captured { entry }]);

    let saved = h.screenshot(ImageFormat::Jpeg, Some("")).await;
    assert!(!saved.in_library);
    assert!(Path::new(&saved.path).starts_with(h.downloads()));
    assert!(saved.path.ends_with(".jpg"));
    assert!(
        h.session
            .screenshot(screenshot(ImageFormat::Png, Some("relative/dir")))
            .await
            .is_err()
    );
    assert_eq!(h.session.status().phase, CapturePhase::Idle);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_gif_is_made_from_the_movie_which_is_removed_or_kept_when_the_gif_fails() {
    let h = Harness::new();
    let started = h
        .session
        .start_recording(recording(RecordingOutput::Gif, Some("")))
        .await
        .unwrap();
    assert_eq!(
        started,
        RecordingStart::Recording {
            output: RecordingOutput::Gif
        }
    );
    let movie = h.fake.movie.lock().unwrap().clone().unwrap();
    assert!(movie.starts_with(h.dir.path().join("captures/files")));
    let Ok(CaptureOutcome::Captured { entry }) = h.session.stop_recording().await else {
        panic!("not captured");
    };
    assert_eq!(entry.kind, CaptureKind::Gif);
    assert!(Path::new(&entry.path).starts_with(h.downloads()));
    assert!(entry.path.ends_with(".gif") && entry.path.contains("Librelog Recording "));
    assert_eq!(
        (entry.width, entry.height, entry.duration_ms),
        (72, 36, 1500)
    );
    assert!(!entry.thumbnail_path.is_empty());
    assert!(!movie.exists());
    assert!(matches!(
        h.session.stop_recording().await,
        Err(Error::NotRecording)
    ));

    h.fake.fail_gif.store(true, Ordering::SeqCst);
    h.session
        .start_recording(recording(RecordingOutput::Gif, Some("")))
        .await
        .unwrap();
    let Ok(CaptureOutcome::Captured { entry }) = h.session.stop_recording().await else {
        panic!("not captured");
    };
    assert_eq!(entry.kind, CaptureKind::Video);
    assert!(entry.path.ends_with(".mp4") && Path::new(&entry.path).is_file());
    assert!(matches!(h.events()[3], CaptureEvent::Failed { .. }));
}

#[tokio::test(flavor = "multi_thread")]
async fn the_capsules_stop_and_discard_are_finished_without_the_frontend() {
    let h = Harness::new();
    h.session
        .start_recording(recording(RecordingOutput::Mp4, None))
        .await
        .unwrap();
    h.fake.push(r#"{"type":"record_stopped","reason":"cap"}"#);
    h.until(|events| matches!(events.last(), Some(CaptureEvent::Captured { .. })))
        .await;
    let events = h.events();
    assert!(matches!(
        &events[..],
        [
            CaptureEvent::RecordingStarted { output: RecordingOutput::Mp4 },
            CaptureEvent::RecordingStopped { reason },
            CaptureEvent::Captured { entry },
        ] if reason == "cap" && entry.kind == CaptureKind::Video && entry.in_library
    ));

    h.session
        .start_recording(recording(RecordingOutput::Mp4, None))
        .await
        .unwrap();
    let movie = h.fake.movie.lock().unwrap().clone().unwrap();
    h.fake.push(r#"{"type":"record_discard"}"#);
    h.until(|events| {
        matches!(events.last(), Some(CaptureEvent::RecordingStopped { reason }) if reason == "discarded")
    })
    .await;
    assert!(!movie.exists());
    assert_eq!(h.session.list_captures().unwrap().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cards_save_moves_a_library_capture_to_the_users_folder_then_reveals_it() {
    let h = Harness::new();
    let folder = h.dir.path().join("Shots");
    let mut request = screenshot(ImageFormat::Png, None);
    request.folder = Some(folder.to_string_lossy().into_owned());
    let Ok(CaptureOutcome::Captured { entry }) = h.session.screenshot(request).await else {
        panic!("not captured");
    };
    let card = |action: &str| {
        h.fake.push(&format!(
            r#"{{"type":"card_action","id":"{}","action":"{action}"}}"#,
            entry.id
        ));
    };
    card("save");
    let wait = || async {
        tokio::time::sleep(Duration::from_millis(400)).await;
    };
    wait().await;
    let saved = h.session.list_captures().unwrap()[0].clone();
    assert!(!saved.in_library);
    assert!(Path::new(&saved.path).starts_with(&folder) && Path::new(&saved.path).is_file());
    assert!(!Path::new(&entry.path).exists());
    assert!(
        h.fake
            .calls()
            .contains(&format!("card_show {} saved=true", entry.id))
    );

    card("save");
    card("copy");
    card("edit");
    wait().await;
    let calls = h.fake.calls();
    assert!(calls.contains(&format!("reveal {}", saved.path)));
    assert!(calls.contains(&format!("copy {}", saved.path)));
    assert!(h.events().contains(&CaptureEvent::CardAction {
        id: entry.id.clone(),
        action: CardActionKind::Edit
    }));
}

#[tokio::test(flavor = "multi_thread")]
async fn an_edited_jpeg_stays_a_jpeg_and_a_copy_lands_beside_it() {
    let h = Harness::new();
    let entry = h.screenshot(ImageFormat::Jpeg, Some("")).await;
    assert!(matches!(
        h.session.save_edited(&entry.id, "aGVsbG8=", true, false),
        Err(Error::BadImage(_))
    ));
    assert!(matches!(
        h.session
            .save_edited("cap-1-0000", &png_base64(4, 4), true, false),
        Err(Error::UnknownCapture)
    ));

    let replaced = h
        .session
        .save_edited(&entry.id, &png_base64(64, 32), true, false)
        .unwrap();
    let bytes = std::fs::read(&entry.path).unwrap();
    assert_eq!(&bytes[..2], [0xFF, 0xD8]);
    assert_eq!(
        (replaced.id.as_str(), replaced.path.as_str()),
        (entry.id.as_str(), entry.path.as_str())
    );
    assert_eq!((replaced.width, replaced.height), (64, 32));
    assert_eq!(replaced.bytes, bytes.len() as u64);

    let beside = h
        .session
        .save_edited(&entry.id, &png_base64(8, 8), false, true)
        .unwrap();
    assert_ne!(beside.id, entry.id);
    assert_eq!(
        Path::new(&beside.path).parent(),
        Path::new(&entry.path).parent()
    );
    assert!(beside.path.ends_with(".jpg"));
    assert!(h.fake.calls().contains(&format!("copy {}", beside.path)));
    let listed = h.session.list_captures().unwrap();
    assert_eq!(
        listed.iter().map(|entry| &entry.id).collect::<Vec<_>>(),
        [&beside.id, &entry.id]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn deleting_removes_a_library_file_and_trashes_a_saved_one() {
    let h = Harness::new();
    let library = h.screenshot(ImageFormat::Png, None).await;
    let saved = h.screenshot(ImageFormat::Png, Some("")).await;
    assert!(matches!(
        h.session.save_capture_as(&saved.id, "copy.png"),
        Err(Error::BadDestination)
    ));
    let copy = h.dir.path().join("copy.png");
    h.session
        .save_capture_as(&saved.id, &copy.to_string_lossy())
        .unwrap();
    assert!(copy.is_file());

    h.session.delete_capture(&library.id).unwrap();
    h.session.delete_capture(&saved.id).unwrap();
    assert!(!Path::new(&library.path).exists());
    assert!(!Path::new(&library.thumbnail_path).exists());
    assert!(h.fake.calls().contains(&format!("trash {}", saved.path)));
    assert!(h.session.list_captures().unwrap().is_empty());
    assert!(matches!(
        h.session.delete_capture(&saved.id),
        Err(Error::UnknownCapture)
    ));
}

#[tokio::test(flavor = "multi_thread")]
async fn quitting_keeps_a_recording_as_a_movie_and_cancels_a_selector() {
    let h = Harness::new();
    h.session
        .start_recording(recording(RecordingOutput::Gif, Some("")))
        .await
        .unwrap();
    h.session.shutdown(Duration::from_secs(5)).await;
    assert_eq!(h.session.status().phase, CapturePhase::Idle);
    let listed = h.session.list_captures().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].kind, CaptureKind::Video);
    assert!(Path::new(&listed[0].path).starts_with(h.downloads()));
    assert!(Path::new(&listed[0].path).is_file());
    let calls = h.fake.calls();
    assert!(
        !calls
            .iter()
            .any(|call| call == "record_cancel" || call.starts_with("make_gif"))
    );

    *h.fake.record_start_delay.lock().unwrap() = Some(Duration::from_millis(300));
    let starting = tokio::spawn({
        let session = h.session.clone();
        async move {
            session
                .start_recording(recording(RecordingOutput::Mp4, None))
                .await
        }
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    h.session.shutdown(Duration::from_secs(5)).await;
    assert_eq!(starting.await.unwrap().unwrap(), RecordingStart::Cancelled);
    assert_eq!(h.session.list_captures().unwrap().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn quitting_while_a_gif_is_written_removes_the_partial_gif_when_time_runs_out() {
    let h = Harness::new();
    *h.fake.gif_delay.lock().unwrap() = Some(Duration::from_secs(2));
    h.session
        .start_recording(recording(RecordingOutput::Gif, None))
        .await
        .unwrap();
    let stopping = tokio::spawn({
        let session = h.session.clone();
        async move { session.stop_recording().await }
    });
    let partial = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(call) = h
                .fake
                .calls()
                .iter()
                .find(|call| call.starts_with("make_gif "))
            {
                return PathBuf::from(call.trim_start_matches("make_gif "));
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(partial.exists());
    let movie = h.fake.movie.lock().unwrap().clone().unwrap();
    h.session.shutdown(Duration::from_millis(300)).await;
    assert!(!partial.exists());
    // The movie the GIF was made from stays where a later launch finds it.
    assert!(movie.is_file());
    let _ = stopping.await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_stopped_recording_is_kept_when_its_reply_is_garbled_or_its_folder_goes_away() {
    let h = Harness::new();
    h.fake.garbled_stop.store(true, Ordering::SeqCst);
    h.session
        .start_recording(recording(RecordingOutput::Mp4, Some("")))
        .await
        .unwrap();
    let Ok(CaptureOutcome::Captured { entry }) = h.session.stop_recording().await else {
        panic!("not captured");
    };
    assert!(Path::new(&entry.path).is_file() && Path::new(&entry.path).starts_with(h.downloads()));
    h.fake.garbled_stop.store(false, Ordering::SeqCst);

    // The GIF fails and its folder vanished: the movie stays in the library.
    h.fake.fail_gif.store(true, Ordering::SeqCst);
    let gone = h.dir.path().join("Gone");
    h.session
        .start_recording(recording(
            RecordingOutput::Gif,
            Some(&gone.to_string_lossy()),
        ))
        .await
        .unwrap();
    std::fs::remove_dir_all(&gone).unwrap();
    std::fs::write(&gone, b"now a file").unwrap();
    let Ok(CaptureOutcome::Captured { entry }) = h.session.stop_recording().await else {
        panic!("not captured");
    };
    assert_eq!(entry.kind, CaptureKind::Video);
    assert!(entry.in_library && Path::new(&entry.path).is_file());
    assert!(entry.path.contains("Librelog Recording "));
    assert!(h.events().iter().any(|event| matches!(
        event,
        CaptureEvent::Failed { message } if message.contains(&entry.path)
    )));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_card_click_counts_only_while_its_card_is_up() {
    let h = Harness::new();
    let entry = h.screenshot(ImageFormat::Png, None).await;
    let copies = || {
        h.fake
            .calls()
            .iter()
            .filter(|call| call.starts_with("copy "))
            .count()
    };
    let copied = copies();
    // An id that never had a card, then this card after it left.
    h.fake
        .push(r#"{"type":"card_action","id":"cap-1-0000","action":"copy"}"#);
    h.fake
        .push(&format!(r#"{{"type":"card_closed","id":"{}"}}"#, entry.id));
    h.fake.push(&format!(
        r#"{{"type":"card_action","id":"{}","action":"copy"}}"#,
        entry.id
    ));
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(copies(), copied);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_malformed_event_is_skipped_without_losing_the_rest_of_its_batch() {
    let h = Harness::new();
    let entry = h.screenshot(ImageFormat::Png, None).await;
    h.fake.push("42");
    h.fake.push(r#"{"type":"from_the_future"}"#);
    h.fake.push(&format!(
        r#"{{"type":"card_action","id":"{}","action":"edit"}}"#,
        entry.id
    ));
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert!(h.events().contains(&CaptureEvent::CardAction {
        id: entry.id,
        action: CardActionKind::Edit
    }));
}

#[tokio::test(flavor = "multi_thread")]
async fn saving_a_screenshot_reads_as_finishing_and_a_stop_during_the_selector_cancels() {
    let h = Harness::new();
    *h.fake.copy_delay.lock().unwrap() = Some(Duration::from_millis(300));
    let taking = tokio::spawn({
        let session = h.session.clone();
        async move { session.screenshot(screenshot(ImageFormat::Png, None)).await }
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        while h.session.status().phase != CapturePhase::Finishing {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    taking.await.unwrap().unwrap();

    *h.fake.record_start_delay.lock().unwrap() = Some(Duration::from_millis(300));
    let starting = tokio::spawn({
        let session = h.session.clone();
        async move {
            session
                .start_recording(recording(RecordingOutput::Mp4, None))
                .await
        }
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(
        h.session.stop_recording().await.unwrap(),
        CaptureOutcome::Cancelled
    );
    assert_eq!(starting.await.unwrap().unwrap(), RecordingStart::Cancelled);
    assert_eq!(h.session.status().phase, CapturePhase::Idle);
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn saving_a_capture_as_itself_by_another_spelling_leaves_it_whole() {
    let h = Harness::new();
    let entry = h.screenshot(ImageFormat::Png, Some("")).await;
    let alias = h.dir.path().join("alias");
    std::os::unix::fs::symlink(h.downloads(), &alias).unwrap();
    let name = Path::new(&entry.path).file_name().unwrap();
    h.session
        .save_capture_as(&entry.id, &alias.join(name).to_string_lossy())
        .unwrap();
    assert_eq!(std::fs::metadata(&entry.path).unwrap().len(), entry.bytes);
    assert!(entry.bytes > 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_folder_that_cannot_be_written_fails_before_the_selector_and_no_temp_is_left() {
    let h = Harness::new();
    let blocked = h.dir.path().join("file");
    std::fs::write(&blocked, b"").unwrap();
    let error = h
        .session
        .screenshot(screenshot(
            ImageFormat::Png,
            Some(&blocked.join("Shots").to_string_lossy()),
        ))
        .await
        .unwrap_err();
    assert!(matches!(error, Error::NotWritable(..)), "{error}");
    assert!(!h.fake.calls().contains(&"screenshot".to_string()));

    h.screenshot(ImageFormat::Png, None).await;
    let hidden = std::fs::read_dir(h.dir.path().join("captures/files"))
        .unwrap()
        .filter_map(Result::ok)
        .filter(|file| file.file_name().to_string_lossy().starts_with('.'))
        .count();
    assert_eq!(hidden, 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn off_macos_nothing_touches_the_disk() {
    let h = Harness::new();
    h.fake.unavailable.store(true, Ordering::SeqCst);
    assert!(h.session.list_captures().unwrap().is_empty());
    assert!(matches!(
        h.session
            .screenshot(screenshot(ImageFormat::Png, None))
            .await,
        Err(Error::Unavailable)
    ));
    assert!(!h.session.status().available);
    assert!(!h.dir.path().join("captures").exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn quitting_never_cancels_a_recording_whose_stop_outlasts_the_budget() {
    let h = Harness::new();
    h.session
        .start_recording(recording(RecordingOutput::Mp4, Some("")))
        .await
        .unwrap();
    let movie = h.fake.movie.lock().unwrap().clone().unwrap();
    *h.fake.stop_delay.lock().unwrap() = Some(Duration::from_secs(3));
    let started = std::time::Instant::now();
    h.session.shutdown(Duration::ZERO).await;
    // Even with no time left it waited for the stop, then left the movie.
    assert!(started.elapsed() >= Duration::from_secs(2));
    assert!(movie.is_file());
    let calls = h.fake.calls();
    assert!(calls.contains(&"record_stop".to_string()));
    assert!(!calls.contains(&"record_cancel".to_string()));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_failed_stop_keeps_a_movie_that_has_frames() {
    let h = Harness::new();
    h.session
        .start_recording(recording(RecordingOutput::Mp4, None))
        .await
        .unwrap();
    let movie = h.fake.movie.lock().unwrap().clone().unwrap();
    h.fake.stop_error.store(true, Ordering::SeqCst);
    assert!(matches!(
        h.session.stop_recording().await,
        Err(Error::Unfinished(..))
    ));
    assert!(movie.is_file());
    assert_eq!(h.session.status().phase, CapturePhase::Idle);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_movie_a_quit_left_hidden_is_recovered_into_the_list() {
    let h = Harness::new();
    let files = h.dir.path().join("captures/files");
    std::fs::create_dir_all(&files).unwrap();
    let hidden = files.join(".capture-0123.mp4");
    std::fs::write(&hidden, b"mp4 with frames").unwrap();
    std::fs::File::options()
        .write(true)
        .open(&hidden)
        .unwrap()
        .set_modified(std::time::SystemTime::now() - Duration::from_secs(3 * 3600))
        .unwrap();
    let recovered = h.session.recover_leftovers();
    assert_eq!(recovered.len(), 1);
    let entry = &recovered[0];
    assert!(!hidden.exists() && Path::new(&entry.path).is_file());
    assert!(entry.path.ends_with(" (recovered).mp4"), "{}", entry.path);
    assert!(entry.in_library && entry.kind == CaptureKind::Video);
    assert_eq!(h.session.list_captures().unwrap(), recovered);
}

#[tokio::test(flavor = "multi_thread")]
async fn every_card_up_stays_actionable_past_four() {
    let h = Harness::new();
    let mut entries = Vec::new();
    for _ in 0..6 {
        entries.push(h.screenshot(ImageFormat::Png, None).await);
    }
    // Two displays show four cards each: the first is still up.
    h.fake.push(&format!(
        r#"{{"type":"card_action","id":"{}","action":"edit"}}"#,
        entries[0].id
    ));
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert!(h.events().contains(&CaptureEvent::CardAction {
        id: entries[0].id.clone(),
        action: CardActionKind::Edit
    }));
}

#[tokio::test(flavor = "multi_thread")]
async fn exporting_over_a_jpeg_capture_keeps_it_a_jpeg_and_refreshes_its_entry() {
    let h = Harness::new();
    let entry = h.screenshot(ImageFormat::Jpeg, Some("")).await;
    crate::export::export(
        Some(&h.session),
        Path::new(&entry.path),
        &png_base64(64, 32),
    )
    .unwrap();
    let bytes = std::fs::read(&entry.path).unwrap();
    assert_eq!(&bytes[..2], [0xFF, 0xD8]);
    let listed = h.session.list_captures().unwrap();
    assert_eq!((listed[0].width, listed[0].height), (64, 32));
    assert_eq!(listed[0].bytes, bytes.len() as u64);
}
