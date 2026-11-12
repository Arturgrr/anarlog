use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::path::Path;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;

use anlg_transcribe_core::{
    BatchEventSender, ProgressTracker, TARGET_SAMPLE_RATE, batch_event_channel, batch_sse_response,
    chunk_channel_audio, json_error_response,
};
use anlg_transcribe_gguf::{CancelToken, Request, TimedWord};
use axum::{
    Json,
    body::Body,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures_util::StreamExt;
use owhisper_interface::ListenParams;
use owhisper_interface::batch;
use owhisper_interface::batch_sse::BatchSseMessage;
use owhisper_interface::stream;
use rodio::Source;
use tokio::io::AsyncWriteExt;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use crate::engine::{BoxedTranscriber, EngineSlot};

const MAX_BATCH_AUDIO_BODY_BYTES: usize = 100 * 1024 * 1024;
const MAX_BATCH_CHANNELS: usize = 8;
const MAX_CONCURRENT_HTTP_BATCH_JOBS: usize = 1;
/// Long enough for a dictation to wait out a meeting's minute-long chunk, and
/// for the meeting to wait out a dictation, but under the client's 60 s idle
/// timeout. The waiting request's body stays unread, so this adds no memory.
pub(crate) const HTTP_BATCH_ADMISSION_WAIT: Duration = Duration::from_secs(30);
const MAX_REJECTED_BATCH_DRAIN_BYTES: usize = 64 * 1024;
const MAX_REJECTED_BATCH_DRAIN_CHUNKS: usize = 64;
const REJECTED_BATCH_DRAIN_TIMEOUT: Duration = Duration::from_millis(100);
const CHANNEL_WINDOW_SAMPLES: usize = TARGET_SAMPLE_RATE as usize * 2 * 60;
/// Speech chunks closer than this are sent together to a model that times
/// its words, up to [`MAX_MERGED_SAMPLES`]; a longer pause stays out, since
/// models invent text on silence.
const MAX_MERGED_GAP_SAMPLES: usize = TARGET_SAMPLE_RATE as usize * 3 / 2;
const MAX_MERGED_SAMPLES: usize = TARGET_SAMPLE_RATE as usize * 25;

#[derive(Clone)]
struct BatchCancellation {
    cancelled: Arc<AtomicBool>,
    engine: CancelToken,
}

impl Default for BatchCancellation {
    fn default() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            engine: CancelToken::new(),
        }
    }
}

impl BatchCancellation {
    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.engine.cancel();
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}

struct CancelBatchOnDrop(BatchCancellation);

impl Drop for CancelBatchOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

pub(crate) fn http_batch_admission() -> Arc<Semaphore> {
    Arc::new(Semaphore::new(MAX_CONCURRENT_HTTP_BATCH_JOBS))
}

/// One batch job runs at a time. A request that arrives during another one
/// waits its turn for up to `wait` before it is turned away.
pub(crate) async fn acquire_http_batch_permit(
    admission: Arc<Semaphore>,
    wait: Duration,
) -> Option<OwnedSemaphorePermit> {
    tokio::time::timeout(wait, admission.acquire_owned())
        .await
        .ok()?
        .ok()
}

pub(crate) fn batch_busy_response() -> Response {
    json_error_response(
        StatusCode::TOO_MANY_REQUESTS,
        "batch_busy",
        "another local batch transcription is already running",
    )
}

#[derive(Debug)]
pub(crate) struct BatchAudioFile {
    file: tempfile::NamedTempFile,
    len: u64,
}

impl BatchAudioFile {
    fn path(&self) -> &Path {
        self.file.path()
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.len == 0
    }
}

#[derive(Debug)]
enum BatchAudioWriteError {
    Body(axum::Error),
    Io(std::io::Error),
    TooLarge,
}

impl From<std::io::Error> for BatchAudioWriteError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

pub(crate) async fn spool_batch_audio(
    body: Body,
    content_type: &str,
) -> Result<BatchAudioFile, Response> {
    spool_batch_audio_with_limit(body, content_type, MAX_BATCH_AUDIO_BODY_BYTES)
        .await
        .map_err(|error| match error {
            BatchAudioWriteError::TooLarge => json_error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "payload_too_large",
                format!("request body exceeds {MAX_BATCH_AUDIO_BODY_BYTES} bytes"),
            ),
            BatchAudioWriteError::Body(error) => json_error_response(
                StatusCode::BAD_REQUEST,
                "invalid_request_body",
                error.to_string(),
            ),
            BatchAudioWriteError::Io(error) => json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed_to_store_audio",
                error.to_string(),
            ),
        })
}

pub(crate) async fn drain_rejected_batch_audio(body: Body) -> Result<(), Response> {
    let drain = async move {
        let mut stream = body.into_data_stream();
        let mut drained = 0usize;

        for _ in 0..MAX_REJECTED_BATCH_DRAIN_CHUNKS {
            if drained >= MAX_REJECTED_BATCH_DRAIN_BYTES {
                break;
            }

            let Some(chunk) = stream.next().await else {
                break;
            };
            let chunk = chunk.map_err(|error| {
                json_error_response(
                    StatusCode::BAD_REQUEST,
                    "invalid_request_body",
                    error.to_string(),
                )
            })?;
            drained = drained.saturating_add(chunk.len());
        }

        Ok(())
    };

    match tokio::time::timeout(REJECTED_BATCH_DRAIN_TIMEOUT, drain).await {
        Ok(result) => result,
        Err(_) => Ok(()),
    }
}

async fn spool_batch_audio_with_limit(
    body: Body,
    content_type: &str,
    max_bytes: usize,
) -> Result<BatchAudioFile, BatchAudioWriteError> {
    let extension = anlg_audio_utils::content_type_to_extension(content_type);
    let file = tempfile::Builder::new()
        .prefix("gguf_local_batch_")
        .suffix(&format!(".{extension}"))
        .tempfile()?;
    let mut writer = tokio::fs::File::from_std(file.reopen()?);
    let mut stream = body.into_data_stream();
    let mut len = 0u64;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(BatchAudioWriteError::Body)?;
        len = len.saturating_add(chunk.len() as u64);
        if len > max_bytes as u64 {
            return Err(BatchAudioWriteError::TooLarge);
        }
        writer.write_all(&chunk).await?;
    }
    writer.flush().await?;

    Ok(BatchAudioFile { file, len })
}

fn spawn_batch_job<T>(
    permit: OwnedSemaphorePermit,
    job: impl FnOnce() -> T + Send + 'static,
) -> tokio::task::JoinHandle<T>
where
    T: Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        job()
    })
}

fn model_load_failed(error: String) -> Response {
    tracing::error!(error, "failed_to_load_model");
    json_error_response(
        StatusCode::INTERNAL_SERVER_ERROR,
        "model_load_failed",
        error,
    )
}

/// Runs the job on a blocking thread with the model, then returns the model
/// to the slot, even when the request that started it went away.
async fn run_job<T: Send + 'static>(
    slot: &EngineSlot,
    engine: BoxedTranscriber,
    permit: OwnedSemaphorePermit,
    job: impl FnOnce(&mut BoxedTranscriber) -> T + Send + 'static,
) -> Option<T> {
    let (result_tx, result_rx) = tokio::sync::oneshot::channel();
    let slot = slot.clone();
    tokio::spawn(async move {
        let handle = spawn_batch_job(permit, move || {
            let mut engine = engine;
            let result =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| job(&mut engine))).ok();
            (engine, result)
        });
        if let Ok((engine, result)) = handle.await {
            slot.put_back(engine).await;
            let _ = result_tx.send(result);
        }
    });
    result_rx.await.ok().flatten()
}

pub(crate) async fn handle_batch(
    audio_file: BatchAudioFile,
    params: ListenParams,
    slot: &EngineSlot,
    permit: OwnedSemaphorePermit,
) -> Response {
    let cancellation = BatchCancellation::default();
    let _cancel_on_drop = CancelBatchOnDrop(cancellation.clone());
    let engine = match slot.take().await {
        Ok(engine) => engine,
        Err(error) => return model_load_failed(error),
    };

    let result = run_job(slot, engine, permit, move |engine| {
        transcribe_batch(audio_file.path(), &params, engine, None, &cancellation)
    })
    .await;

    match result {
        Some(Ok(response)) => Json(response).into_response(),
        Some(Err(error)) => {
            tracing::error!(error = %error, "batch_transcription_failed");
            json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "transcription_failed",
                error.to_string(),
            )
        }
        None => json_error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "transcription_failed",
            "task panicked",
        ),
    }
}

pub(crate) async fn handle_batch_sse(
    audio_file: BatchAudioFile,
    params: ListenParams,
    slot: &EngineSlot,
    permit: OwnedSemaphorePermit,
) -> Response {
    let engine = match slot.take().await {
        Ok(engine) => engine,
        Err(error) => return model_load_failed(error),
    };

    let (event_tx, event_rx) = batch_event_channel();
    let cancellation = BatchCancellation::default();
    let slot = slot.clone();
    tokio::spawn(async move {
        let job_tx = event_tx.clone();
        let result = run_job(&slot, engine, permit, move |engine| {
            transcribe_batch(
                audio_file.path(),
                &params,
                engine,
                Some(job_tx),
                &cancellation,
            )
        })
        .await;
        let message = match result {
            Some(Ok(response)) => BatchSseMessage::Result { response },
            Some(Err(error)) => BatchSseMessage::Error {
                error: "transcription_failed".to_string(),
                detail: error.to_string(),
            },
            None => BatchSseMessage::Error {
                error: "transcription_failed".to_string(),
                detail: "task panicked".to_string(),
            },
        };
        event_tx.send_terminal(message);
    });

    batch_sse_response(event_rx)
}

fn transcribe_batch(
    audio_path: &Path,
    params: &ListenParams,
    engine: &mut BoxedTranscriber,
    event_tx: Option<BatchEventSender>,
    cancellation: &BatchCancellation,
) -> Result<batch::Response, crate::Error> {
    let source = anlg_audio_utils::source_from_path(audio_path)?;
    transcribe_source(source, params, engine, event_tx, cancellation)
}

fn transcribe_source<S>(
    source: S,
    params: &ListenParams,
    engine: &mut BoxedTranscriber,
    event_tx: Option<BatchEventSender>,
    cancellation: &BatchCancellation,
) -> Result<batch::Response, crate::Error>
where
    S: Source<Item = f32>,
{
    let channel_files = resample_to_channel_files(source, event_tx.as_ref(), cancellation)?;
    let channel_count = channel_files.len();
    let channel_durations = channel_files
        .iter()
        .map(|channel| channel.sample_count as f64 / TARGET_SAMPLE_RATE as f64)
        .collect::<Vec<_>>();
    let total_duration = channel_durations.iter().copied().fold(0.0_f64, f64::max);

    let metadata = crate::build_metadata(&engine.model_name());
    let request = Request {
        languages: params
            .languages
            .iter()
            .map(|language| language.bcp47_code())
            .collect(),
        prompt: None,
        cancel: Some(cancellation.engine.clone()),
    };
    let mut response_channels = Vec::with_capacity(channel_count);
    let mut progress = ProgressTracker::new(vec![0.0; channel_count], total_duration, event_tx);
    ensure_batch_active(&progress, cancellation)?;
    progress.emit(None);

    for (channel_idx, channel) in channel_files.into_iter().enumerate() {
        ensure_batch_active(&progress, cancellation)?;
        let channel_index = [channel_idx as i32, channel_count as i32];
        let chunks = ChannelChunkIterator::new(channel, engine.times_words())?;
        let mut work = ChannelWork {
            channel_idx,
            channel_index: &channel_index,
            metadata: &metadata,
            request: &request,
            progress: &mut progress,
            cancellation,
        };
        let (words, transcript, confidence) =
            work.transcribe(chunks, channel_durations[channel_idx], engine)?;

        response_channels.push(batch::Channel {
            alternatives: vec![batch::Alternatives {
                transcript,
                confidence,
                words,
            }],
        });
    }

    let mut metadata_json = serde_json::to_value(&metadata).unwrap_or_default();
    if let Some(obj) = metadata_json.as_object_mut() {
        obj.insert("duration".to_string(), serde_json::json!(total_duration));
        obj.insert(
            "channels".to_string(),
            serde_json::json!(response_channels.len()),
        );
    }

    Ok(batch::Response {
        metadata: metadata_json,
        results: batch::Results {
            channels: response_channels,
        },
    })
}

#[derive(Debug)]
struct ResampledChannelFile {
    file: tempfile::NamedTempFile,
    sample_count: usize,
}

fn resample_to_channel_files<S>(
    source: S,
    event_tx: Option<&BatchEventSender>,
    cancellation: &BatchCancellation,
) -> Result<Vec<ResampledChannelFile>, crate::Error>
where
    S: Source<Item = f32>,
{
    let channel_count = u16::from(source.channels()).max(1) as usize;
    if channel_count > MAX_BATCH_CHANNELS {
        return Err(crate::Error::protocol(format!(
            "local batch transcription supports at most {MAX_BATCH_CHANNELS} audio channels; the recording declares {channel_count}"
        )));
    }

    let files = (0..channel_count)
        .map(|_| {
            tempfile::Builder::new()
                .prefix("gguf_local_channel_")
                .suffix(".wav")
                .tempfile()
        })
        .collect::<std::io::Result<Vec<_>>>()?;
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: TARGET_SAMPLE_RATE,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut writers = files
        .iter()
        .map(|file| {
            let writer = BufWriter::new(file.reopen()?);
            hound::WavWriter::new(writer, spec).map_err(crate::Error::from)
        })
        .collect::<Result<Vec<_>, _>>()?;

    let info = anlg_audio_utils::for_each_resampled_channel_block::<_, crate::Error>(
        source,
        TARGET_SAMPLE_RATE,
        |channels| {
            if cancellation.is_cancelled() {
                return Err(batch_request_cancelled());
            }
            if event_tx.is_some_and(BatchEventSender::is_closed) {
                return Err(batch_receiver_unavailable());
            }
            for (writer, channel) in writers.iter_mut().zip(channels) {
                for sample in *channel {
                    writer.write_sample(*sample)?;
                }
            }
            Ok(())
        },
    )?;

    for writer in writers {
        writer.finalize()?;
    }

    Ok(files
        .into_iter()
        .map(|file| ResampledChannelFile {
            file,
            sample_count: info.frame_count,
        })
        .collect())
}

/// A channel's speech chunks, read from its resampled file in bounded
/// windows so a long recording is never held in memory whole.
struct ChannelChunkIterator {
    reader: hound::WavReader<BufReader<File>>,
    _file: tempfile::NamedTempFile,
    pending: std::vec::IntoIter<anlg_audio_chunking::AudioChunk>,
    next_window_start: usize,
    merge: bool,
    finished: bool,
}

impl ChannelChunkIterator {
    fn new(channel: ResampledChannelFile, merge: bool) -> Result<Self, crate::Error> {
        let reader = hound::WavReader::open(channel.file.path())?;
        Ok(Self {
            reader,
            _file: channel.file,
            pending: Vec::new().into_iter(),
            next_window_start: 0,
            merge,
            finished: false,
        })
    }

    fn read_next_window(&mut self) -> Result<Option<Vec<f32>>, crate::Error> {
        let samples = self
            .reader
            .samples::<f32>()
            .take(CHANNEL_WINDOW_SAMPLES)
            .collect::<Result<Vec<_>, _>>()?;
        Ok((!samples.is_empty()).then_some(samples))
    }
}

impl Iterator for ChannelChunkIterator {
    type Item = Result<anlg_audio_chunking::AudioChunk, crate::Error>;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            if let Some(chunk) = self.pending.next() {
                return Some(Ok(chunk));
            }
            if self.finished {
                return None;
            }

            let samples = match self.read_next_window() {
                Ok(Some(samples)) => samples,
                Ok(None) => {
                    self.finished = true;
                    return None;
                }
                Err(error) => {
                    self.finished = true;
                    return Some(Err(error));
                }
            };

            let window_start = self.next_window_start;
            self.next_window_start += samples.len();
            let mut chunks = match chunk_channel_audio::<crate::Error>(&samples) {
                Ok(chunks) if self.merge => merge_nearby_speech(chunks, &samples),
                Ok(chunks) => chunks,
                Err(error) => {
                    self.finished = true;
                    return Some(Err(error));
                }
            };
            for chunk in &mut chunks {
                chunk.sample_start += window_start;
                chunk.sample_end += window_start;
            }
            self.pending = chunks.into_iter();
        }
    }
}

/// Joins speech chunks separated by short pauses into runs of up to
/// [`MAX_MERGED_SAMPLES`], pauses included. `window` holds the samples the
/// chunk offsets index.
fn merge_nearby_speech(
    chunks: Vec<anlg_audio_chunking::AudioChunk>,
    window: &[f32],
) -> Vec<anlg_audio_chunking::AudioChunk> {
    let mut spans: Vec<(usize, usize)> = Vec::new();
    for chunk in &chunks {
        match spans.last_mut() {
            Some((start, end))
                if chunk.sample_start.saturating_sub(*end) <= MAX_MERGED_GAP_SAMPLES
                    && chunk.sample_end.saturating_sub(*start) <= MAX_MERGED_SAMPLES =>
            {
                *end = (*end).max(chunk.sample_end);
            }
            _ => spans.push((chunk.sample_start, chunk.sample_end)),
        }
    }
    spans
        .into_iter()
        .map(|(start, end)| {
            let end = end.min(window.len());
            anlg_audio_chunking::AudioChunk {
                samples: window[start.min(end)..end].to_vec(),
                sample_start: start,
                sample_end: end,
            }
        })
        .collect()
}

struct ChannelWork<'a> {
    channel_idx: usize,
    channel_index: &'a [i32],
    metadata: &'a stream::Metadata,
    request: &'a Request,
    progress: &'a mut ProgressTracker,
    cancellation: &'a BatchCancellation,
}

impl ChannelWork<'_> {
    fn transcribe(
        &mut self,
        chunks: impl Iterator<Item = Result<anlg_audio_chunking::AudioChunk, crate::Error>>,
        channel_duration: f64,
        engine: &mut BoxedTranscriber,
    ) -> Result<(Vec<batch::Word>, String, f64), crate::Error> {
        let mut all_words = Vec::new();
        let mut transcript = String::new();

        for chunk in chunks {
            ensure_batch_active(self.progress, self.cancellation)?;
            let chunk = chunk?;
            let chunk_start = chunk.sample_start as f64 / TARGET_SAMPLE_RATE as f64;
            self.progress.update_channel(self.channel_idx, chunk_start);

            let result = engine
                .transcribe(&chunk.samples, self.request)
                .map_err(|error| match error {
                    anlg_transcribe_gguf::Error::Cancelled => batch_request_cancelled(),
                    error => crate::Error::from(error),
                })?;
            ensure_batch_active(self.progress, self.cancellation)?;

            let text = result.text.trim();
            let words = result
                .words
                .iter()
                .map(|word| shifted(word, chunk_start))
                .collect::<Vec<_>>();
            if !text.is_empty() {
                if let Some(tx) = self.progress.event_tx()
                    && !tx.send_blocking(BatchSseMessage::Segment {
                        response: self.segment_response(
                            text,
                            &words,
                            chunk_start,
                            chunk.samples.len() as f64 / TARGET_SAMPLE_RATE as f64,
                            result.language.clone(),
                        ),
                    })
                {
                    return Err(batch_receiver_unavailable());
                }
                if !transcript.is_empty() {
                    transcript.push(' ');
                }
                transcript.push_str(text);
            }
            all_words.extend(words.into_iter().map(|word| batch::Word {
                channel: self.channel_idx as i32,
                ..batch::Word::from(word)
            }));

            self.progress.update_channel(
                self.channel_idx,
                chunk.sample_end as f64 / TARGET_SAMPLE_RATE as f64,
            );
            self.progress.emit(Some(transcript.clone()));
        }
        self.progress
            .update_channel(self.channel_idx, channel_duration);
        self.progress.emit(Some(transcript.clone()));

        let confidence = if all_words.is_empty() {
            0.0
        } else {
            all_words.iter().map(|word| word.confidence).sum::<f64>() / all_words.len() as f64
        };
        Ok((all_words, transcript, confidence))
    }

    fn segment_response(
        &self,
        text: &str,
        words: &[stream::Word],
        start: f64,
        duration: f64,
        language: Option<String>,
    ) -> stream::StreamResponse {
        let confidence = if words.is_empty() {
            0.0
        } else {
            words.iter().map(|word| word.confidence).sum::<f64>() / words.len() as f64
        };
        stream::StreamResponse::TranscriptResponse {
            start,
            duration,
            is_final: true,
            speech_final: true,
            from_finalize: false,
            channel: stream::Channel {
                alternatives: vec![stream::Alternatives {
                    transcript: text.to_string(),
                    languages: language.into_iter().collect(),
                    words: words.to_vec(),
                    confidence,
                }],
            },
            metadata: self.metadata.clone(),
            channel_index: self.channel_index.to_vec(),
        }
    }
}

fn shifted(word: &TimedWord, offset: f64) -> stream::Word {
    stream::Word {
        word: word.text.clone(),
        start: offset + word.start,
        end: offset + word.end,
        confidence: word.confidence,
        speaker: None,
        punctuated_word: None,
        language: None,
    }
}

fn ensure_batch_active(
    progress: &ProgressTracker,
    cancellation: &BatchCancellation,
) -> Result<(), crate::Error> {
    if cancellation.is_cancelled() {
        return Err(batch_request_cancelled());
    }
    if progress.is_cancelled() {
        return Err(batch_receiver_unavailable());
    }
    Ok(())
}

fn batch_receiver_unavailable() -> crate::Error {
    crate::Error::protocol("batch event receiver unavailable")
}

fn batch_request_cancelled() -> crate::Error {
    crate::Error::protocol("batch request cancelled")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A dictation finishing during a meeting's chunk (or the reverse) waits for
    /// it instead of failing; only a job that outlasts the wait is turned away.
    #[tokio::test]
    async fn a_second_batch_waits_its_turn_then_is_turned_away() {
        let admission = Arc::new(Semaphore::new(1));
        let permit = acquire_http_batch_permit(Arc::clone(&admission), Duration::ZERO)
            .await
            .unwrap();

        let waiting = tokio::spawn(acquire_http_batch_permit(
            Arc::clone(&admission),
            Duration::from_secs(5),
        ));
        tokio::time::sleep(Duration::from_millis(20)).await;
        drop(permit);
        let permit = waiting.await.unwrap().expect("waited for the first job");

        assert!(
            acquire_http_batch_permit(Arc::clone(&admission), Duration::from_millis(20))
                .await
                .is_none()
        );
        drop(permit);
    }

    #[test]
    fn nearby_speech_merges_up_to_the_run_limit_and_long_pauses_split_it() {
        let rate = TARGET_SAMPLE_RATE as usize;
        let window = (0..rate * 60).map(|index| index as f32).collect::<Vec<_>>();
        let chunk = |start_s: f64, end_s: f64| {
            let (start, end) = (
                (start_s * rate as f64) as usize,
                (end_s * rate as f64) as usize,
            );
            anlg_audio_chunking::AudioChunk {
                samples: window[start..end].to_vec(),
                sample_start: start,
                sample_end: end,
            }
        };
        let merged = merge_nearby_speech(
            vec![
                chunk(0.0, 4.0),
                chunk(5.0, 9.0),
                chunk(20.0, 24.0),
                chunk(24.5, 40.0),
                chunk(40.5, 50.0),
            ],
            &window,
        );
        let spans = merged
            .iter()
            .map(|chunk| (chunk.sample_start / rate, chunk.sample_end / rate))
            .collect::<Vec<_>>();
        assert_eq!(spans, [(0, 9), (20, 40), (40, 50)]);
        assert!(merged.iter().all(|chunk| chunk.samples.len()
            == chunk.sample_end - chunk.sample_start
            && chunk.samples[0] == chunk.sample_start as f32));
    }

    #[tokio::test]
    async fn batch_body_spooling_enforces_limit() {
        let audio = spool_batch_audio_with_limit(Body::from("audio"), "audio/wav", 16)
            .await
            .unwrap();
        assert_eq!(std::fs::read(audio.path()).unwrap(), b"audio");

        let error = spool_batch_audio_with_limit(Body::from("12345"), "audio/wav", 4)
            .await
            .unwrap_err();
        assert!(matches!(error, BatchAudioWriteError::TooLarge));
    }
}
