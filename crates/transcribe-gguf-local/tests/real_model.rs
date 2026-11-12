//! Serves a real model file on `/v1/listen` and transcribes a recording
//! through it, the way the `whispercpp` batch provider does. CI has no model
//! file, so this runs only when `LIBRELOG_GGUF_TEST_MODEL` names one (and
//! `LIBRELOG_GGUF_TEST_CATALOG` optionally names its catalog id).

use std::time::Instant;

use owhisper_interface::batch_sse::BatchSseMessage;
use transcribe_gguf_local::TranscribeService;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_real_model_answers_the_listen_contract() {
    let Some(path) = std::env::var_os("LIBRELOG_GGUF_TEST_MODEL") else {
        eprintln!("LIBRELOG_GGUF_TEST_MODEL is unset; skipping");
        return;
    };
    let catalog = std::env::var("LIBRELOG_GGUF_TEST_CATALOG")
        .ok()
        .map(|id| id.parse().unwrap());
    anlg_transcribe_gguf::set_device_preference(anlg_transcribe_gguf::DevicePreference::Cpu);
    let service = TranscribeService::for_model(
        path.into(),
        anlg_transcribe_gguf::LoadOptions {
            catalog,
            device: anlg_transcribe_gguf::DevicePreference::Cpu,
        },
    );
    let app = service.into_router(|error: String| async move {
        (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error)
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

    let started = Instant::now();
    let body = reqwest::Client::new()
        .post(format!(
            "http://{addr}/v1/listen?channels=1&sample_rate=16000&language=en"
        ))
        .header("content-type", "audio/mpeg")
        .header("accept", "text/event-stream")
        .body(std::fs::read(anlg_data::english_1::AUDIO_MP3_PATH).unwrap())
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    let elapsed = started.elapsed();

    let messages = body
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|data| serde_json::from_str::<BatchSseMessage>(data.trim()).unwrap())
        .collect::<Vec<_>>();
    let segments = messages
        .iter()
        .filter(|message| matches!(message, BatchSseMessage::Segment { .. }))
        .count();
    let response = match messages.last() {
        Some(BatchSseMessage::Result { response }) => response,
        other => panic!("expected a result, got {other:?}"),
    };
    let alternative = &response.results.channels[0].alternatives[0];
    eprintln!(
        "{segments} segments in {elapsed:.2?}; metadata {}",
        response.metadata
    );
    eprintln!("text: {}", alternative.transcript);
    for word in alternative.words.iter().take(10) {
        eprintln!("  {:>7.2} {:>7.2} {}", word.start, word.end, word.word);
    }

    assert!(segments > 1);
    assert!(alternative.transcript.split_whitespace().count() > 50);
    let duration = response.metadata["duration"].as_f64().unwrap();
    for pair in alternative.words.windows(2) {
        assert!(pair[0].start <= pair[1].start, "{pair:?}");
    }
    for word in &alternative.words {
        assert!(
            word.start <= word.end && word.end <= duration + 0.01,
            "{word:?}"
        );
    }
}
