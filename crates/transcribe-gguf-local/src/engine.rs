use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};

use anlg_transcribe_gguf::{EngineTranscript, Request};

/// What the server transcribes with: the transcribe.cpp engine, or a fake in
/// tests.
pub trait Transcriber: Send + 'static {
    fn transcribe(
        &mut self,
        samples: &[f32],
        request: &Request,
    ) -> Result<EngineTranscript, anlg_transcribe_gguf::Error>;

    /// The model's name for the response metadata.
    fn model_name(&self) -> String;

    /// Whether the model times its own words or segments, so nearby speech
    /// can go to it in one run: fewer, longer runs are much faster, while a
    /// model without timestamps gets each stretch of speech alone, which
    /// keeps its spread-out word times close to the speech.
    fn times_words(&self) -> bool {
        false
    }
}

impl Transcriber for anlg_transcribe_gguf::Engine {
    fn transcribe(
        &mut self,
        samples: &[f32],
        request: &Request,
    ) -> Result<EngineTranscript, anlg_transcribe_gguf::Error> {
        anlg_transcribe_gguf::Engine::transcribe(self, samples, request)
    }

    fn model_name(&self) -> String {
        let (architecture, variant) = anlg_transcribe_gguf::Engine::model_name(self);
        format!("{architecture}/{variant}")
    }

    fn times_words(&self) -> bool {
        self.timestamps() != anlg_transcribe_gguf::TimestampSource::None
    }
}

pub type BoxedTranscriber = Box<dyn Transcriber>;
pub type LoadFn = Arc<dyn Fn() -> Result<BoxedTranscriber, String> + Send + Sync>;

/// An idle model is released after this long; the next request loads it again.
const IDLE_UNLOAD: Duration = Duration::from_secs(60);
const IDLE_CHECK: Duration = Duration::from_secs(3);

struct SlotState {
    engine: Option<BoxedTranscriber>,
    last_used: Instant,
}

/// The loaded model, loaded on first use and released when idle. Batch jobs
/// run one at a time, so a job takes the model out and puts it back.
#[derive(Clone)]
pub(crate) struct EngineSlot {
    load: LoadFn,
    state: Arc<tokio::sync::Mutex<SlotState>>,
}

impl EngineSlot {
    pub(crate) fn new(load: LoadFn, preloaded: Option<BoxedTranscriber>) -> Self {
        let slot = Self {
            load,
            state: Arc::new(tokio::sync::Mutex::new(SlotState {
                engine: preloaded,
                last_used: Instant::now(),
            })),
        };
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(release_when_idle(Arc::downgrade(&slot.state)));
        }
        slot
    }

    /// The model, loading it when it isn't loaded.
    pub(crate) async fn take(&self) -> Result<BoxedTranscriber, String> {
        let mut state = self.state.lock().await;
        if let Some(engine) = state.engine.take() {
            return Ok(engine);
        }
        let load = Arc::clone(&self.load);
        tokio::task::spawn_blocking(move || load())
            .await
            .map_err(|error| format!("model load panicked: {error}"))?
    }

    pub(crate) async fn put_back(&self, engine: BoxedTranscriber) {
        let mut state = self.state.lock().await;
        state.engine = Some(engine);
        state.last_used = Instant::now();
    }

    /// Loads the model now, so the first request doesn't wait for it.
    pub(crate) async fn warm(&self) -> Result<(), String> {
        let engine = self.take().await?;
        self.put_back(engine).await;
        Ok(())
    }
}

async fn release_when_idle(state: Weak<tokio::sync::Mutex<SlotState>>) {
    loop {
        tokio::time::sleep(IDLE_CHECK).await;
        let Some(state) = state.upgrade() else {
            return;
        };
        let mut state = state.lock().await;
        if state.engine.is_some() && state.last_used.elapsed() >= IDLE_UNLOAD {
            tracing::info!("releasing the idle transcription model");
            if let Some(engine) = state.engine.take() {
                drop(state);
                let _ = tokio::task::spawn_blocking(move || drop(engine)).await;
            }
        }
    }
}
