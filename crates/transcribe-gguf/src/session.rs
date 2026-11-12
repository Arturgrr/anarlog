//! The transcribe.cpp session owner. It recreates the native session around
//! every run so retained scheduler scratch never outlives the inference that
//! sized it, keeps the text a decode stopped for repeating itself produced,
//! and removes segments that only echo the prompt and subtitle credits the
//! model invented at the end of a clip.
//!
//! Adapted from anomalyco/hex at 3dc7f538 (`src/transcription/gguf_session.rs`).

use crate::credits;

/// On a GPU only the per-token decoder runs on the CPU, and extra
/// spin-waiting ggml workers stall it under load, so it keeps to the calling
/// thread.
pub(crate) fn session_options(
    device_type: transcribe_cpp::DeviceType,
) -> transcribe_cpp::SessionOptions {
    match device_type {
        transcribe_cpp::DeviceType::Gpu | transcribe_cpp::DeviceType::Igpu => {
            transcribe_cpp::SessionOptions {
                n_threads: 1,
                ..Default::default()
            }
        }
        _ => transcribe_cpp::SessionOptions::default(),
    }
}

pub(crate) struct OfflineSession {
    model: transcribe_cpp::Model,
    session: Option<transcribe_cpp::Session>,
    options: transcribe_cpp::SessionOptions,
}

impl OfflineSession {
    pub(crate) fn new(model: transcribe_cpp::Model) -> transcribe_cpp::Result<Self> {
        let options = session_options(model.device()?.device_type);
        let session = model.session_with(&options)?;
        Ok(Self {
            model,
            session: Some(session),
            options,
        })
    }

    pub(crate) fn model(&self) -> &transcribe_cpp::Model {
        &self.model
    }

    pub(crate) fn run(
        &mut self,
        samples: &[f32],
        options: &transcribe_cpp::RunOptions,
        cancel: Option<&transcribe_cpp::CancelToken>,
    ) -> transcribe_cpp::Result<transcribe_cpp::Transcript> {
        // A session keeps input-sized scheduler buffers for its lifetime. Drop
        // each used session before creating its successor so a long inference
        // cannot pin that high-water mark or overlap two sessions' decoder
        // state.
        let mut session = match self.session.take() {
            Some(session) => session,
            None => self.model.session_with(&self.options)?,
        };
        if let Some(cancel) = cancel {
            session.set_cancel_token(cancel);
        }
        let result =
            keep_repetition_partial(session.run(samples, options)).map(|mut transcript| {
                if let Some(prompt) = &options.prompt {
                    drop_prompt_echo(&mut transcript, prompt);
                }
                drop_subtitle_credit(&mut transcript);
                transcript
            });
        drop(session);
        match self.model.session_with(&self.options) {
            Ok(session) => {
                self.session = Some(session);
                result
            }
            Err(recovery_error) => match result {
                Ok(_) => Err(recovery_error),
                Err(run_error) => Err(run_error),
            },
        }
    }
}

/// transcribe.cpp stops a decoder that starts looping and reports the text
/// before the loop as an error. That text is still what was said.
pub(crate) fn keep_repetition_partial(
    result: transcribe_cpp::Result<transcribe_cpp::Transcript>,
) -> transcribe_cpp::Result<transcribe_cpp::Transcript> {
    match result {
        Err(transcribe_cpp::Error::OutputRepetition {
            partial: Some(partial),
            ..
        }) => Ok(*partial),
        result => result,
    }
}

fn normalize_spoken(text: &str) -> String {
    text.split_whitespace()
        .filter_map(|word| {
            let word = word.trim_matches(|character: char| character.is_ascii_punctuation());
            if word.is_empty() {
                return None;
            }
            let word = word.to_ascii_lowercase();
            Some(match word.as_str() {
                "zero" => "0".to_string(),
                "one" => "1".to_string(),
                "two" => "2".to_string(),
                "three" => "3".to_string(),
                "four" => "4".to_string(),
                "five" => "5".to_string(),
                "six" => "6".to_string(),
                "seven" => "7".to_string(),
                "eight" => "8".to_string(),
                "nine" => "9".to_string(),
                _ => word,
            })
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Drops segments that only repeat the prompt. Whisper and Qwen3-ASR can
/// return their context prompt verbatim on silence or noise. Speech that
/// merely contains a term is kept, and so is a single term.
pub(crate) fn drop_prompt_echo(transcript: &mut transcribe_cpp::Transcript, prompt: &str) {
    let is_separator = |character: char| matches!(character, ',' | ';' | '\n');
    let hints = prompt
        .split(is_separator)
        .filter(|hint| !hint.trim().is_empty())
        .count();
    if hints < 2 {
        return;
    }
    let normalize = |text: &str| normalize_spoken(&text.replace(is_separator, " "));
    let prompt = normalize(prompt);
    let echoes = |text: &str| normalize(text) == prompt;
    if transcript.segments.is_empty() {
        if echoes(&transcript.text) {
            transcript.text.clear();
            transcript.words.clear();
        }
        return;
    }
    if !transcript
        .segments
        .iter()
        .any(|segment| echoes(&segment.text))
    {
        return;
    }
    let words = std::mem::take(&mut transcript.words);
    let mut segments = Vec::new();
    for mut segment in std::mem::take(&mut transcript.segments) {
        if echoes(&segment.text) {
            continue;
        }
        let first = (segment.first_word.max(0) as usize).min(words.len());
        let last = (first + segment.n_words.max(0) as usize).min(words.len());
        segment.first_word = transcript.words.len() as i32;
        let index = segments.len() as i32;
        transcript
            .words
            .extend(words[first..last].iter().cloned().map(|mut word| {
                word.seg_index = index;
                word
            }));
        segments.push(segment);
    }
    transcript.text = segments
        .iter()
        .map(|segment| segment.text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    transcript.segments = segments;
}

/// Removes a subtitle credit the model appended to the end of the clip from
/// the text, the last segments, and their words.
pub(crate) fn drop_subtitle_credit(transcript: &mut transcribe_cpp::Transcript) {
    let Some((text, removed_from_text)) = credits::strip(&transcript.text) else {
        return;
    };
    transcript.text = text;
    let mut removed = if transcript.segments.is_empty() {
        removed_from_text
    } else {
        0
    };
    while let Some(segment) = transcript.segments.last_mut() {
        let Some((kept, tokens)) = credits::strip(&segment.text) else {
            break;
        };
        if kept.is_empty() {
            let first = (segment.first_word.max(0) as usize).min(transcript.words.len());
            transcript.words.truncate(first);
            transcript.segments.pop();
            continue;
        }
        segment.text = kept;
        removed = tokens;
        break;
    }
    if transcript.segments.is_empty() && transcript.text.is_empty() {
        transcript.words.clear();
        return;
    }
    let last_segment = transcript.segments.last_mut();
    let floor = last_segment
        .as_ref()
        .map_or(0, |segment| segment.first_word.max(0) as usize);
    let mut popped = 0;
    while removed > 0 && transcript.words.len() > floor {
        let Some(word) = transcript.words.last() else {
            break;
        };
        let tokens = credits::token_count(&word.text);
        if tokens > removed {
            break;
        }
        removed -= tokens;
        transcript.words.pop();
        popped += 1;
    }
    if let Some(segment) = last_segment {
        segment.n_words = (segment.n_words - popped).max(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transcript(segments: &[&str]) -> transcribe_cpp::Transcript {
        let mut transcript = transcribe_cpp::Transcript::default();
        let mut first_word = 0;
        for text in segments {
            let n_words = text.split_whitespace().count() as i32;
            transcript.segments.push(transcribe_cpp::Segment {
                text: text.to_string(),
                first_word,
                n_words,
                ..Default::default()
            });
            for word in text.split_whitespace() {
                transcript.words.push(transcribe_cpp::Word {
                    text: word.into(),
                    ..Default::default()
                });
            }
            first_word += n_words;
        }
        transcript.text = segments.join(" ");
        transcript
    }

    fn words(transcript: &transcribe_cpp::Transcript) -> Vec<&str> {
        transcript
            .words
            .iter()
            .map(|word| word.text.as_str())
            .collect()
    }

    #[test]
    fn a_decode_stopped_for_repeating_keeps_its_text_and_truncation_still_fails() {
        let partial = |text: &str| {
            Some(Box::new(transcribe_cpp::Transcript {
                text: text.into(),
                ..Default::default()
            }))
        };
        let repeated = keep_repetition_partial(Err(transcribe_cpp::Error::OutputRepetition {
            message: "loop".into(),
            partial: partial("send it now"),
        }));
        assert_eq!(repeated.unwrap().text, "send it now");
        let truncated = keep_repetition_partial(Err(transcribe_cpp::Error::OutputTruncated {
            message: "budget".into(),
            partial: partial("send it"),
        }));
        assert!(matches!(
            truncated,
            Err(transcribe_cpp::Error::OutputTruncated { .. })
        ));
    }

    #[test]
    fn only_segments_that_echo_a_multi_term_prompt_are_dropped() {
        let mut mixed = transcript(&["Let's ship it.", "T3 Code, Ottobit."]);
        drop_prompt_echo(&mut mixed, "T3 Code,Ottobit");
        assert_eq!(mixed.text, "Let's ship it.");
        assert_eq!(words(&mixed), ["Let's", "ship", "it."]);

        let mut leading = transcript(&["T3 Code, Ottobit.", "Let's ship it."]);
        drop_prompt_echo(&mut leading, "T3 Code\nOttobit");
        assert_eq!(leading.text, "Let's ship it.");
        assert_eq!(
            (leading.segments[0].first_word, leading.segments[0].n_words),
            (0, 3)
        );

        let mut speech = transcript(&["We shipped T3 Code today"]);
        let before = speech.clone();
        drop_prompt_echo(&mut speech, "T3 Code, Ottobit");
        assert_eq!(speech, before);

        let mut single = transcript(&["Ottobit."]);
        let before = single.clone();
        drop_prompt_echo(&mut single, "Ottobit");
        assert_eq!(single, before);
    }

    #[test]
    fn a_trailing_subtitle_credit_is_dropped_from_text_segments_and_words() {
        let mut own = transcript(&["On se voit demain.", "Sous-titrage Société Radio-Canada"]);
        drop_subtitle_credit(&mut own);
        assert_eq!(own.text, "On se voit demain.");
        assert_eq!(own.segments.len(), 1);
        assert_eq!(words(&own), ["On", "se", "voit", "demain."]);

        let mut joined = transcript(&["On se voit demain. Sous-titrage Société Radio-Canada"]);
        drop_subtitle_credit(&mut joined);
        assert_eq!(joined.segments[0].text, "On se voit demain.");
        assert_eq!(joined.segments[0].n_words, 4);
        assert_eq!(words(&joined), ["On", "se", "voit", "demain."]);
    }

    #[test]
    fn gpu_sessions_bound_decoder_threads() {
        use transcribe_cpp::DeviceType;
        assert_eq!(session_options(DeviceType::Gpu).n_threads, 1);
        assert_eq!(session_options(DeviceType::Igpu).n_threads, 1);
        assert_eq!(session_options(DeviceType::Cpu).n_threads, 0);
    }
}
