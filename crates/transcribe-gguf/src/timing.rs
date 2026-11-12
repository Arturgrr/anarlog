//! Word times for every model family. Parakeet, Nemotron and GigaAM give each
//! word's time; Whisper gives segments, whose words are spread across them;
//! Qwen3-ASR and Cohere give text only, whose words are spread across the
//! audio they came from. Times are seconds from the start of the run's audio,
//! stay inside it, and never run backwards, so speaker assignment can rely on
//! them.

use crate::{TimedWord, TimestampSource};

const MS: f64 = 1_000.0;

/// `transcript`'s words, timed within `[0, duration]` seconds.
pub(crate) fn words(
    transcript: &transcribe_cpp::Transcript,
    duration: f64,
) -> (Vec<TimedWord>, TimestampSource) {
    if let Some(words) = native_words(transcript, duration) {
        return (words, TimestampSource::Word);
    }
    if let Some(words) = segment_words(transcript, duration) {
        return (words, TimestampSource::Segment);
    }
    (
        spread(&transcript.text, 0.0, duration.max(0.0), 1.0),
        TimestampSource::None,
    )
}

fn native_words(transcript: &transcribe_cpp::Transcript, duration: f64) -> Option<Vec<TimedWord>> {
    let words = transcript
        .words
        .iter()
        .enumerate()
        .filter_map(|(index, word)| {
            let text = word.text.trim();
            (!text.is_empty()).then(|| {
                (
                    text.to_string(),
                    word.t0_ms as f64 / MS,
                    word.t1_ms as f64 / MS,
                    word_confidence(transcript, index),
                )
            })
        })
        .collect::<Vec<_>>();
    if words.is_empty() || !has_times(words.iter().map(|(_, start, end, _)| (*start, *end))) {
        return None;
    }
    Some(monotonic(words, duration))
}

fn segment_words(transcript: &transcribe_cpp::Transcript, duration: f64) -> Option<Vec<TimedWord>> {
    let segments = transcript
        .segments
        .iter()
        .filter(|segment| !segment.text.trim().is_empty())
        .collect::<Vec<_>>();
    if segments.is_empty()
        || !has_times(
            segments
                .iter()
                .map(|segment| (segment.t0_ms as f64 / MS, segment.t1_ms as f64 / MS)),
        )
    {
        return None;
    }
    let mut words = Vec::new();
    let mut floor = 0.0_f64;
    for segment in segments {
        let start = (segment.t0_ms as f64 / MS).clamp(floor, duration.max(floor));
        let end = (segment.t1_ms as f64 / MS).clamp(start, duration.max(start));
        words.extend(spread(&segment.text, start, end, 1.0));
        floor = end;
    }
    Some(words)
}

/// Whether the spans carry real times rather than zeros or NaN.
fn has_times(spans: impl Iterator<Item = (f64, f64)>) -> bool {
    let mut any = false;
    for (start, end) in spans {
        if !start.is_finite() || !end.is_finite() || start < 0.0 {
            return false;
        }
        any |= end > 0.0;
    }
    any
}

/// The mean probability of the tokens a word came from, when the model gave
/// them.
fn word_confidence(transcript: &transcribe_cpp::Transcript, word_index: usize) -> f64 {
    let probabilities = transcript
        .tokens
        .iter()
        .filter(|token| token.word_index == word_index as i32 && token.p.is_finite())
        .map(|token| f64::from(token.p))
        .collect::<Vec<_>>();
    if probabilities.is_empty() {
        1.0
    } else {
        (probabilities.iter().sum::<f64>() / probabilities.len() as f64).clamp(0.0, 1.0)
    }
}

fn monotonic(words: Vec<(String, f64, f64, f64)>, duration: f64) -> Vec<TimedWord> {
    let limit = duration.max(0.0);
    let mut floor = 0.0_f64;
    words
        .into_iter()
        .map(|(text, start, end, confidence)| {
            let start = start.clamp(floor, limit.max(floor));
            let end = end.clamp(start, limit.max(start));
            floor = start;
            TimedWord {
                text,
                start,
                end,
                confidence,
            }
        })
        .collect()
}

/// `text`'s words spread evenly across `[start, end]`.
pub(crate) fn spread(text: &str, start: f64, end: f64, confidence: f64) -> Vec<TimedWord> {
    let words = text.split_whitespace().collect::<Vec<_>>();
    let step = if words.is_empty() {
        0.0
    } else {
        (end - start).max(0.0) / words.len() as f64
    };
    words
        .into_iter()
        .enumerate()
        .map(|(index, word)| TimedWord {
            text: word.to_string(),
            start: start + step * index as f64,
            end: start + step * (index + 1) as f64,
            confidence,
        })
        .collect()
}

/// Shifts `words` to start `offset` seconds later.
pub(crate) fn offset(words: &mut [TimedWord], offset: f64) {
    for word in words {
        word.start += offset;
        word.end += offset;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(text: &str, t0_ms: i64, t1_ms: i64) -> transcribe_cpp::Segment {
        transcribe_cpp::Segment {
            text: text.into(),
            t0_ms,
            t1_ms,
            ..Default::default()
        }
    }

    fn word(text: &str, t0_ms: i64, t1_ms: i64) -> transcribe_cpp::Word {
        transcribe_cpp::Word {
            text: text.into(),
            t0_ms,
            t1_ms,
            ..Default::default()
        }
    }

    fn times(words: &[TimedWord]) -> Vec<(f64, f64)> {
        words.iter().map(|word| (word.start, word.end)).collect()
    }

    #[test]
    fn each_family_gets_ordered_word_times_within_the_audio() {
        // Parakeet: its own word times, kept in order and inside the audio.
        let native = transcribe_cpp::Transcript {
            text: "hello there world".into(),
            words: vec![
                word(" hello", 100, 400),
                word(" there", 350, 700),
                word(" world", 800, 1_600),
            ],
            ..Default::default()
        };
        let (words, source) = super::words(&native, 1.5);
        assert_eq!(source, TimestampSource::Word);
        assert_eq!(words[0].text, "hello");
        assert_eq!(times(&words), [(0.1, 0.4), (0.35, 0.7), (0.8, 1.5)]);

        // Whisper: segments, their words spread across each.
        let segmented = transcribe_cpp::Transcript {
            text: "one two three".into(),
            segments: vec![segment("one two", 0, 1_000), segment("three", 1_000, 1_500)],
            ..Default::default()
        };
        let (words, source) = super::words(&segmented, 2.0);
        assert_eq!(source, TimestampSource::Segment);
        assert_eq!(times(&words), [(0.0, 0.5), (0.5, 1.0), (1.0, 1.5)]);

        // Qwen3-ASR and Cohere: text only, spread across the audio.
        let untimed = transcribe_cpp::Transcript {
            text: "a b c d".into(),
            segments: vec![segment("a b c d", 0, 0)],
            ..Default::default()
        };
        let (words, source) = super::words(&untimed, 2.0);
        assert_eq!(source, TimestampSource::None);
        assert_eq!(times(&words), [(0.0, 0.5), (0.5, 1.0), (1.0, 1.5), (1.5, 2.0)]);
    }
}
