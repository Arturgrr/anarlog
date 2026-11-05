use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use futures_util::StreamExt;
use tauri::async_runtime::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::Error;
use crate::preview::{Preview, PreviewConfig, RecordingUpdate};
use tauri::ipc::Channel;

const SAMPLE_RATE: u32 = 16_000;
/// 20 ms buffers, so the HUD meters the voice as often as Hex does.
const CHUNK_SIZE: usize = 320;
/// The live preview streams 100 ms packets, as it always has.
const PREVIEW_CHUNK_SIZE: usize = 1_600;
const MAX_RECORDING_SECONDS: u64 = 300;

/// Receives the RMS of each captured buffer.
pub type Meter = Arc<dyn Fn(f32) + Send + Sync>;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RecordedAudio {
    pub file_path: String,
    pub duration_ms: u64,
    pub transcript: Option<String>,
}

struct ActiveRecording {
    owner: String,
    cancellation: CancellationToken,
    task: JoinHandle<Result<RecordedAudio, Error>>,
    finalize: Arc<AtomicBool>,
}

pub struct Recorder {
    active: Mutex<Option<ActiveRecording>>,
    completed: Mutex<HashSet<PathBuf>>,
}

impl Recorder {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(None),
            completed: Mutex::new(HashSet::new()),
        }
    }

    pub fn start(
        &self,
        audio: Arc<dyn anlg_audio::AudioProvider>,
        microphone_device: Option<String>,
        owner: String,
    ) -> Result<(), Error> {
        self.start_with_feedback(audio, microphone_device, owner, None, None, None)
    }

    pub fn start_with_feedback(
        &self,
        audio: Arc<dyn anlg_audio::AudioProvider>,
        microphone_device: Option<String>,
        owner: String,
        preview: Option<PreviewConfig>,
        updates: Option<Channel<RecordingUpdate>>,
        meter: Option<Meter>,
    ) -> Result<(), Error> {
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if active.is_some() {
            return Err(Error::AlreadyRecording);
        }

        let stream = audio
            .open_mic_capture(microphone_device, SAMPLE_RATE, CHUNK_SIZE)
            .map_err(|error| Error::Capture(error.to_string()))?;
        let temporary_file = tempfile::Builder::new()
            .prefix("librelog-dictation-")
            .suffix(".wav")
            .tempfile()
            .map_err(|error| Error::Recording(error.to_string()))?;
        let (_, path) = temporary_file
            .keep()
            .map_err(|error| Error::Recording(error.error.to_string()))?;

        let cancellation = CancellationToken::new();
        let task_cancellation = cancellation.clone();
        let task_path = path.clone();
        let finalize = Arc::new(AtomicBool::new(false));
        let task_finalize = finalize.clone();
        let task = tauri::async_runtime::spawn(async move {
            let preview = preview
                .zip(updates)
                .map(|(config, updates)| Preview::start(config, updates));
            let result = record_to_file(
                stream,
                task_cancellation,
                &task_path,
                preview,
                meter,
                task_finalize,
            )
            .await;
            if result.is_err() {
                let _ = std::fs::remove_file(&task_path);
            }
            result
        });

        *active = Some(ActiveRecording {
            owner,
            cancellation,
            task,
            finalize,
        });
        Ok(())
    }

    pub async fn stop(&self, owner: &str) -> Result<RecordedAudio, Error> {
        let active = self.take_active(owner)?.ok_or(Error::NotRecording)?;
        active.finalize.store(true, Ordering::SeqCst);
        active.cancellation.cancel();
        let recorded = active
            .task
            .await
            .map_err(|error| Error::Task(error.to_string()))??;
        self.completed
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(PathBuf::from(&recorded.file_path));
        Ok(recorded)
    }

    pub async fn cancel(&self, owner: &str) -> Result<(), Error> {
        let Some(active) = self.take_active(owner)? else {
            return Ok(());
        };

        active.cancellation.cancel();
        match active.task.await {
            Ok(Ok(recorded)) => {
                let _ = std::fs::remove_file(recorded.file_path);
            }
            Ok(Err(_)) => {}
            Err(error) => return Err(Error::Task(error.to_string())),
        }
        Ok(())
    }

    pub fn discard(&self, file_path: String) -> Result<(), Error> {
        let path = PathBuf::from(file_path);
        let removed = self
            .completed
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&path);
        if !removed {
            return Err(Error::UnknownRecording);
        }

        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(Error::Recording(error.to_string())),
        }
    }

    fn take_active(&self, owner: &str) -> Result<Option<ActiveRecording>, Error> {
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if active
            .as_ref()
            .is_some_and(|recording| recording.owner != owner)
        {
            return Err(Error::AlreadyRecording);
        }
        Ok(active.take())
    }
}

async fn record_to_file(
    mut stream: anlg_audio::CaptureStream,
    cancellation: CancellationToken,
    path: &Path,
    mut preview: Option<Preview>,
    meter: Option<Meter>,
    finalize: Arc<AtomicBool>,
) -> Result<RecordedAudio, Error> {
    let specification = hound::WavSpec {
        channels: 1,
        sample_rate: SAMPLE_RATE,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut writer = hound::WavWriter::create(path, specification)
        .map_err(|error| Error::Recording(error.to_string()))?;
    let deadline = tokio::time::sleep(std::time::Duration::from_secs(MAX_RECORDING_SECONDS));
    tokio::pin!(deadline);
    let mut sample_count = 0_u64;
    let mut pending = Vec::with_capacity(PREVIEW_CHUNK_SIZE);

    loop {
        tokio::select! {
            _ = cancellation.cancelled() => break,
            _ = &mut deadline => break,
            next = stream.next() => {
                let Some(frame) = next else {
                    break;
                };
                let frame = frame.map_err(|error| Error::Capture(error.to_string()))?;
                let samples = frame.preferred_mic();
                for sample in samples.iter() {
                    writer
                        .write_sample(*sample)
                        .map_err(|error| Error::Recording(error.to_string()))?;
                }
                sample_count += samples.len() as u64;
                if let Some(meter) = &meter {
                    meter(crate::events::rms(&samples));
                }
                if preview.is_some() {
                    pending.extend_from_slice(&samples);
                    if pending.len() >= PREVIEW_CHUNK_SIZE {
                        if preview.as_ref().is_some_and(|preview| !preview.send(&pending)) {
                            preview = None;
                        }
                        pending.clear();
                    }
                }
            }
        }
    }
    if !pending.is_empty()
        && preview
            .as_ref()
            .is_some_and(|preview| !preview.send(&pending))
    {
        preview = None;
    }

    writer
        .finalize()
        .map_err(|error| Error::Recording(error.to_string()))?;

    let transcript = if finalize.load(Ordering::SeqCst) {
        if let Some(preview) = preview {
            preview.finish().await
        } else {
            None
        }
    } else {
        None
    };
    Ok(RecordedAudio {
        transcript,
        file_path: path.to_string_lossy().into_owned(),
        duration_ms: sample_count.saturating_mul(1_000) / u64::from(SAMPLE_RATE),
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use anlg_audio::{AudioProvider, CaptureConfig, CaptureFrame, CaptureStream};
    use futures_util::stream;

    use super::*;

    struct TestAudio;

    impl AudioProvider for TestAudio {
        fn open_capture(&self, _config: CaptureConfig) -> Result<CaptureStream, anlg_audio::Error> {
            unreachable!()
        }

        fn open_speaker_capture(
            &self,
            _sample_rate: u32,
            _chunk_size: usize,
        ) -> Result<CaptureStream, anlg_audio::Error> {
            unreachable!()
        }

        fn open_mic_capture(
            &self,
            _device: Option<String>,
            _sample_rate: u32,
            _chunk_size: usize,
        ) -> Result<CaptureStream, anlg_audio::Error> {
            let frame = CaptureFrame {
                raw_mic: Arc::from([0.25_f32; CHUNK_SIZE]),
                raw_speaker: Arc::from([]),
                aec_mic: None,
            };
            Ok(CaptureStream::new(stream::unfold(
                frame,
                |frame| async move {
                    tokio::time::sleep(std::time::Duration::from_millis(1)).await;
                    Some((Ok(frame.clone()), frame))
                },
            )))
        }

        fn default_device_name(&self) -> String {
            "test-mic".to_string()
        }

        fn list_mic_devices(&self) -> Vec<String> {
            vec![self.default_device_name()]
        }

        fn play_silence(&self) -> std::sync::mpsc::Sender<()> {
            std::sync::mpsc::channel().0
        }

        fn play_bytes(&self, _bytes: &'static [u8]) -> std::sync::mpsc::Sender<()> {
            std::sync::mpsc::channel().0
        }

        fn probe_mic(&self, _device: Option<String>) -> Result<(), anlg_audio::Error> {
            Ok(())
        }

        fn probe_speaker(&self) -> Result<(), anlg_audio::Error> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn records_and_discards_a_temporary_wav() {
        let recorder = Recorder::new();
        recorder
            .start(Arc::new(TestAudio), None, "test".into())
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;

        let recorded = recorder.stop("test").await.unwrap();
        let path = PathBuf::from(&recorded.file_path);
        let reader = hound::WavReader::open(&path).unwrap();

        assert_eq!(reader.spec().channels, 1);
        assert_eq!(reader.spec().sample_rate, SAMPLE_RATE);
        assert!(recorded.duration_ms > 0);
        assert!(path.exists());

        recorder.discard(recorded.file_path).unwrap();
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn another_owner_cannot_stop_or_cancel_a_recording() {
        let recorder = Recorder::new();
        recorder
            .start(Arc::new(TestAudio), None, "chat".into())
            .unwrap();
        assert!(matches!(
            recorder.stop("system").await,
            Err(Error::AlreadyRecording)
        ));
        assert!(matches!(
            recorder.cancel("system").await,
            Err(Error::AlreadyRecording)
        ));
        recorder.cancel("chat").await.unwrap();
        recorder
            .start(Arc::new(TestAudio), None, "system".into())
            .unwrap();
        recorder.cancel("system").await.unwrap();
    }

    #[tokio::test]
    async fn preview_failure_does_not_interrupt_wav_capture() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let failed = Arc::new(AtomicBool::new(false));
        let received = failed.clone();
        let updates = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body
                && json.contains("previewUnavailable")
            {
                received.store(true, Ordering::SeqCst);
            }
            Ok(())
        });
        let recorder = Recorder::new();
        recorder
            .start_with_feedback(
                Arc::new(TestAudio),
                None,
                "test".into(),
                Some(PreviewConfig {
                    provider: "unsupported".into(),
                    base_url: "http://localhost".into(),
                    api_key: String::new(),
                    params: Default::default(),
                }),
                Some(updates),
                None,
            )
            .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while !failed.load(Ordering::SeqCst) {
                tokio::time::sleep(std::time::Duration::from_millis(1)).await;
            }
        })
        .await
        .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        let recorded = recorder.stop("test").await.unwrap();
        assert!(recorded.duration_ms > 0);
        recorder.discard(recorded.file_path).unwrap();
    }

    /// The HUD's auto level reads raw loudness; the old feed scaled the RMS
    /// by 8 and pinned ordinary speech at full.
    #[tokio::test]
    async fn the_hud_meter_gets_each_buffers_raw_rms() {
        let levels = Arc::new(Mutex::new(Vec::new()));
        let heard = levels.clone();
        let recorder = Recorder::new();
        recorder
            .start_with_feedback(
                Arc::new(TestAudio),
                None,
                "test".into(),
                None,
                None,
                Some(Arc::new(move |rms| heard.lock().unwrap().push(rms))),
            )
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        recorder.cancel("test").await.unwrap();
        let levels = levels.lock().unwrap();
        assert!(!levels.is_empty());
        assert!(levels.iter().all(|rms| (rms - 0.25).abs() < 1e-6));
    }

    #[tokio::test]
    async fn rejects_parallel_recordings() {
        let recorder = Recorder::new();
        recorder
            .start(Arc::new(TestAudio), None, "test".into())
            .unwrap();

        assert!(matches!(
            recorder.start(Arc::new(TestAudio), None, "test".into()),
            Err(Error::AlreadyRecording)
        ));

        recorder.cancel("test").await.unwrap();
    }
}
