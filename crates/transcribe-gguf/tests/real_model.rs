//! Transcribes a recording with a real model file. CI has none, so this runs
//! only when `LIBRELOG_GGUF_TEST_MODEL` names one:
//!
//! ```sh
//! LIBRELOG_GGUF_TEST_MODEL=/path/parakeet-tdt-0.6b-v3-Q8_0.gguf \
//! LIBRELOG_GGUF_TEST_CATALOG=gguf-parakeet-tdt-0.6b-v3 \
//! cargo test -p transcribe-gguf --test real_model -- --nocapture
//! ```
//!
//! `LIBRELOG_GGUF_TEST_CATALOG` (optional) checks the file is that catalog
//! model and applies its language rules; `LIBRELOG_GGUF_TEST_DEVICE` is
//! `auto`, `gpu` or `cpu` (default `cpu`).

use std::time::Instant;

use transcribe_gguf::{DevicePreference, Engine, GgufModel, LoadOptions, Request};

#[test]
fn a_real_model_transcribes_english_with_ordered_word_times() {
    let Some(path) = std::env::var_os("LIBRELOG_GGUF_TEST_MODEL") else {
        eprintln!("LIBRELOG_GGUF_TEST_MODEL is unset; skipping");
        return;
    };
    let catalog = std::env::var("LIBRELOG_GGUF_TEST_CATALOG")
        .ok()
        .map(|id| id.parse::<GgufModel>().unwrap());
    let device = match std::env::var("LIBRELOG_GGUF_TEST_DEVICE").as_deref() {
        Ok("auto") => DevicePreference::Auto,
        Ok("gpu") => DevicePreference::Gpu,
        _ => DevicePreference::Cpu,
    };

    let mut reader = hound::WavReader::open(anlg_data::english_1::AUDIO_PATH).unwrap();
    assert_eq!(reader.spec().sample_rate, 16_000);
    assert_eq!(reader.spec().channels, 1);
    let samples = reader
        .samples::<i16>()
        .map(|sample| f32::from(sample.unwrap()) / f32::from(i16::MAX))
        .collect::<Vec<_>>();
    let duration = samples.len() as f64 / 16_000.0;

    let started = Instant::now();
    let mut engine = Engine::load(
        std::path::Path::new(&path),
        &LoadOptions { catalog, device },
    )
    .unwrap();
    let load = started.elapsed();
    let started = Instant::now();
    let transcript = engine
        .transcribe(
            &samples,
            &Request {
                languages: vec!["en".into()],
                ..Default::default()
            },
        )
        .unwrap();
    let run = started.elapsed();

    eprintln!(
        "model {:?} on {}; load {:.2?}, {duration:.1} s of audio in {run:.2?} ({:.1}x real time)",
        engine.model_name(),
        engine.device_label(),
        load,
        duration / run.as_secs_f64(),
    );
    eprintln!(
        "timestamps {:?}, {} words, language {:?}",
        transcript.timestamps,
        transcript.words.len(),
        transcript.language
    );
    eprintln!("text: {}", transcript.text);
    for word in transcript.words.iter().take(12) {
        eprintln!("  {:>7.2} {:>7.2} {}", word.start, word.end, word.text);
    }

    assert!(transcript.text.split_whitespace().count() > 50);
    let lower = transcript.text.to_lowercase();
    assert!(
        ["the", "and", "you"]
            .iter()
            .any(|word| lower.contains(word)),
        "not English: {}",
        transcript.text
    );
    assert!(!transcript.words.is_empty());
    for pair in transcript.words.windows(2) {
        assert!(pair[0].start <= pair[1].start, "{pair:?}");
    }
    for word in &transcript.words {
        assert!(
            word.start <= word.end && word.end <= duration + 0.01,
            "{word:?}"
        );
    }
}
