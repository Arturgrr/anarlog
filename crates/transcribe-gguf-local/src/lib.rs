//! The internal server's `/v1/listen` for transcribe.cpp models: the batch
//! JSON and server-sent-events contract the `whispercpp` batch provider
//! speaks (owhisper-client's `WhisperCppAdapter`). Live WebSocket streaming
//! is not offered; a WebSocket request gets 501.

mod batch;
mod engine;

use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use anlg_transcribe_core::json_error_response;
use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::{IntoResponse, Response},
};
use owhisper_interface::ListenParams;
use owhisper_interface::stream::{Extra, Metadata, ModelInfo};
use tokio::sync::Semaphore;
use tower::Service;

pub use engine::{BoxedTranscriber, LoadFn, Transcriber};

pub const LISTEN_PATH: &str = "/v1/listen";
pub const HEALTH_PATH: &str = "/health";

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Audio(#[from] anlg_audio_utils::Error),
    #[error(transparent)]
    Wav(#[from] hound::Error),
    #[error(transparent)]
    Engine(#[from] anlg_transcribe_gguf::Error),
    #[error(transparent)]
    Chunking(#[from] anlg_audio_chunking::Error),
    #[error("{message}")]
    Protocol { message: String },
}

impl Error {
    pub(crate) fn protocol(message: impl Into<String>) -> Self {
        Self::Protocol {
            message: message.into(),
        }
    }
}

#[derive(Clone)]
pub struct TranscribeService {
    slot: engine::EngineSlot,
    batch_admission: Arc<Semaphore>,
}

impl TranscribeService {
    /// A server for `path`, loaded on first use with `options`.
    pub fn for_model(path: PathBuf, options: anlg_transcribe_gguf::LoadOptions) -> Self {
        Self::builder()
            .loader(Arc::new(move || {
                let device = anlg_transcribe_gguf::device_preference();
                anlg_transcribe_gguf::Engine::load(
                    &path,
                    &anlg_transcribe_gguf::LoadOptions {
                        device,
                        ..options.clone()
                    },
                )
                .map(|engine| Box::new(engine) as BoxedTranscriber)
                .map_err(|error| error.to_string())
            }))
            .build()
    }

    pub fn builder() -> TranscribeServiceBuilder {
        TranscribeServiceBuilder::default()
    }

    pub fn into_router<F, Fut>(self, on_error: F) -> axum::Router
    where
        F: FnOnce(String) -> Fut + Clone + Send + Sync + 'static,
        Fut: Future<Output = (StatusCode, String)> + Send,
    {
        let service = axum::error_handling::HandleError::new(self, on_error);
        axum::Router::new()
            .route(HEALTH_PATH, axum::routing::get(|| async { "ok" }))
            .route_service(LISTEN_PATH, service)
    }
}

#[derive(Default)]
pub struct TranscribeServiceBuilder {
    loader: Option<LoadFn>,
    preloaded: Option<BoxedTranscriber>,
}

impl TranscribeServiceBuilder {
    pub fn loader(mut self, loader: LoadFn) -> Self {
        self.loader = Some(loader);
        self
    }

    /// A model already loaded, used until it goes idle.
    pub fn preloaded(mut self, engine: BoxedTranscriber) -> Self {
        self.preloaded = Some(engine);
        self
    }

    pub fn build(self) -> TranscribeService {
        let loader = self
            .loader
            .expect("TranscribeServiceBuilder requires a loader");
        let warm = self.preloaded.is_none();
        let slot = engine::EngineSlot::new(loader, self.preloaded);
        if warm && let Ok(handle) = tokio::runtime::Handle::try_current() {
            let slot = slot.clone();
            handle.spawn(async move {
                match slot.warm().await {
                    Ok(()) => tracing::info!("gguf_model_warmup_completed"),
                    Err(error) => tracing::warn!(error, "gguf_model_warmup_failed"),
                }
            });
        }
        TranscribeService {
            slot,
            batch_admission: batch::http_batch_admission(),
        }
    }
}

pub(crate) fn build_metadata(model_name: &str) -> Metadata {
    Metadata {
        model_info: ModelInfo {
            name: model_name.to_string(),
            version: "1.0".to_string(),
            arch: "transcribe-cpp".to_string(),
        },
        extra: Some(Extra::default().into()),
        ..Default::default()
    }
}

fn header(req: &Request<Body>, name: &str) -> Option<String> {
    req.headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parse_listen_params(query: &str) -> Result<ListenParams, serde_html_form::de::Error> {
    serde_html_form::from_str(query)
}

impl Service<Request<Body>> for TranscribeService {
    type Response = Response;
    type Error = String;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, req: Request<Body>) -> Self::Future {
        let slot = self.slot.clone();
        let batch_admission = Arc::clone(&self.batch_admission);

        Box::pin(async move {
            let is_ws = req
                .headers()
                .get("upgrade")
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| value.eq_ignore_ascii_case("websocket"));
            if is_ws {
                return Ok(json_error_response(
                    StatusCode::NOT_IMPLEMENTED,
                    "live_unsupported",
                    "this on-device model transcribes after recording only",
                ));
            }

            let params = match parse_listen_params(req.uri().query().unwrap_or("")) {
                Ok(params) => params,
                Err(error) => {
                    return Ok((StatusCode::BAD_REQUEST, error.to_string()).into_response());
                }
            };

            let Some(permit) =
                batch::acquire_http_batch_permit(batch_admission, batch::HTTP_BATCH_ADMISSION_WAIT)
                    .await
            else {
                return Ok(
                    match batch::drain_rejected_batch_audio(req.into_body()).await {
                        Ok(()) => batch::batch_busy_response(),
                        Err(response) => response,
                    },
                );
            };
            let content_type = header(&req, "content-type")
                .unwrap_or_else(|| "application/octet-stream".to_string());
            let accept = header(&req, "accept").unwrap_or_default();
            let audio_file = match batch::spool_batch_audio(req.into_body(), &content_type).await {
                Ok(audio_file) => audio_file,
                Err(response) => return Ok(response),
            };
            if audio_file.is_empty() {
                return Ok((StatusCode::BAD_REQUEST, "request body is empty").into_response());
            }

            if accept.contains("text/event-stream") {
                Ok(batch::handle_batch_sse(audio_file, params, &slot, permit).await)
            } else {
                Ok(batch::handle_batch(audio_file, params, &slot, permit).await)
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use std::net::SocketAddr;
    use std::sync::Mutex;

    use anlg_transcribe_gguf::{EngineTranscript, TimedWord, TimestampSource};
    use owhisper_interface::batch_sse::BatchSseMessage;

    use super::*;

    /// Answers every chunk with two timed words and records what it was asked.
    struct FakeEngine {
        seen_languages: Arc<Mutex<Vec<Vec<String>>>>,
    }

    impl Transcriber for FakeEngine {
        fn transcribe(
            &mut self,
            samples: &[f32],
            request: &anlg_transcribe_gguf::Request,
        ) -> Result<EngineTranscript, anlg_transcribe_gguf::Error> {
            self.seen_languages
                .lock()
                .unwrap()
                .push(request.languages.clone());
            let duration = samples.len() as f64 / 16_000.0;
            Ok(EngineTranscript {
                text: "hello world".into(),
                language: Some("en".into()),
                words: vec![
                    TimedWord {
                        text: "hello".into(),
                        start: 0.0,
                        end: duration / 2.0,
                        confidence: 0.9,
                    },
                    TimedWord {
                        text: "world".into(),
                        start: duration / 2.0,
                        end: duration,
                        confidence: 0.7,
                    },
                ],
                timestamps: TimestampSource::Word,
            })
        }

        fn model_name(&self) -> String {
            "fake/fake".into()
        }
    }

    async fn serve(service: TranscribeService) -> SocketAddr {
        let app = service
            .into_router(|err: String| async move { (StatusCode::INTERNAL_SERVER_ERROR, err) });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        addr
    }

    fn fake_service(languages: Arc<Mutex<Vec<Vec<String>>>>) -> TranscribeService {
        TranscribeService::builder()
            .loader(Arc::new(move || {
                Ok(Box::new(FakeEngine {
                    seen_languages: Arc::clone(&languages),
                }) as BoxedTranscriber)
            }))
            .build()
    }

    fn post(addr: SocketAddr, accept: Option<&str>) -> reqwest::RequestBuilder {
        let request = reqwest::Client::new()
            .post(format!(
                "http://{addr}/v1/listen?channels=1&sample_rate=16000&language=pt"
            ))
            .header("content-type", "audio/wav")
            .body(std::fs::read(anlg_data::english_1::AUDIO_PATH).unwrap());
        match accept {
            Some(accept) => request.header("accept", accept),
            None => request,
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_model_that_cannot_load_answers_500_model_load_failed() {
        let service = TranscribeService::for_model(
            std::env::temp_dir().join("missing-gguf-model.gguf"),
            anlg_transcribe_gguf::LoadOptions {
                catalog: None,
                device: anlg_transcribe_gguf::DevicePreference::Cpu,
            },
        );
        let addr = serve(service).await;
        for accept in [None, Some("text/event-stream")] {
            let response = post(addr, accept).send().await.unwrap();
            assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
            let body: serde_json::Value = response.json().await.unwrap();
            assert_eq!(body["error"], "model_load_failed");
        }
    }

    /// The `whispercpp` batch provider's contract: progress, a segment per
    /// speech chunk, then the result; word times on the recording's clock,
    /// in order, on their channel; and the request's language passed on.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn batch_json_and_sse_follow_the_listen_contract() {
        let languages = Arc::new(Mutex::new(Vec::new()));
        let addr = serve(fake_service(Arc::clone(&languages))).await;

        let json: owhisper_interface::batch::Response =
            post(addr, None).send().await.unwrap().json().await.unwrap();
        let alternative = &json.results.channels[0].alternatives[0];
        assert!(alternative.transcript.starts_with("hello world"));
        assert!(alternative.words.len() >= 2);
        assert!(
            alternative
                .words
                .windows(2)
                .all(|pair| pair[0].start <= pair[1].start && pair[0].end <= pair[1].start + 1e-9)
        );
        assert!(alternative.words.iter().all(|word| word.channel == 0));
        assert!(json.metadata["duration"].as_f64().unwrap() > 1.0);
        assert_eq!(languages.lock().unwrap()[0], ["pt"]);

        let body = post(addr, Some("text/event-stream"))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        let messages = body
            .lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .map(|data| serde_json::from_str::<BatchSseMessage>(data.trim()).unwrap())
            .collect::<Vec<_>>();
        for kind in ["progress", "segment"] {
            assert!(
                messages.iter().any(|message| matches!(
                    (kind, message),
                    ("progress", BatchSseMessage::Progress { .. })
                        | ("segment", BatchSseMessage::Segment { .. })
                )),
                "no {kind} event"
            );
        }
        match messages.last().unwrap() {
            BatchSseMessage::Result { response } => {
                assert_eq!(
                    response.results.channels[0].alternatives[0].words.len(),
                    alternative.words.len()
                );
            }
            other => panic!("expected a result last, got {other:?}"),
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn live_websocket_requests_are_refused() {
        let addr = serve(fake_service(Arc::default())).await;
        let response = reqwest::Client::new()
            .get(format!("http://{addr}/v1/listen"))
            .header("connection", "upgrade")
            .header("upgrade", "websocket")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_IMPLEMENTED);
    }
}
