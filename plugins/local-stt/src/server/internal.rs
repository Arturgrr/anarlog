use std::{
    net::{Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::{Arc, Mutex},
};

use axum::{Router, error_handling::HandleError};
use ractor::{Actor, ActorName, ActorProcessingErr, ActorRef, RpcReplyPort};
use reqwest::StatusCode;
use tower_http::cors::{self, CorsLayer};

use super::{ServerInfo, ServerStatus};
pub enum InternalSTTMessage {
    GetHealth(RpcReplyPort<ServerInfo>),
    ServerError(String),
}

/// A model the caller already loaded (to check a picked file), handed to the
/// first server so it isn't loaded twice. A restarted server loads its own.
pub type Preloaded = Arc<Mutex<Option<anlg_transcribe_gguf_local::BoxedTranscriber>>>;

#[derive(Clone)]
pub struct InternalSTTArgs {
    /// The catalog model served; `None` for a file the user picked.
    pub model: Option<crate::LocalModel>,
    pub model_path: PathBuf,
    pub preloaded: Preloaded,
}

pub struct InternalSTTState {
    base_url: String,
    model: Option<crate::LocalModel>,
    model_path: PathBuf,
    shutdown: tokio::sync::watch::Sender<()>,
    server_task: tokio::task::JoinHandle<()>,
}

pub struct InternalSTTActor;

impl InternalSTTActor {
    pub fn name() -> ActorName {
        "internal_stt".into()
    }
}

fn transcribe_service(args: &InternalSTTArgs) -> anlg_transcribe_gguf_local::TranscribeService {
    let catalog = match &args.model {
        Some(crate::LocalModel::Gguf(model)) => Some(*model),
        _ => None,
    };
    let path = args.model_path.clone();
    let mut builder = anlg_transcribe_gguf_local::TranscribeService::builder().loader(Arc::new(
        move || {
            anlg_transcribe_gguf::Engine::load(
                &path,
                &anlg_transcribe_gguf::LoadOptions {
                    catalog,
                    device: anlg_transcribe_gguf::device_preference(),
                },
            )
            .map(|engine| Box::new(engine) as anlg_transcribe_gguf_local::BoxedTranscriber)
            .map_err(|error| error.to_string())
        },
    ));
    let preloaded = args
        .preloaded
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take();
    if let Some(engine) = preloaded {
        builder = builder.preloaded(engine);
    }
    builder.build()
}

#[ractor::async_trait]
impl Actor for InternalSTTActor {
    type Msg = InternalSTTMessage;
    type State = InternalSTTState;
    type Arguments = InternalSTTArgs;

    async fn pre_start(
        &self,
        myself: ActorRef<Self::Msg>,
        args: Self::Arguments,
    ) -> Result<Self::State, ActorProcessingErr> {
        let service = HandleError::new(transcribe_service(&args), move |err: String| async move {
            let _ = myself.send_message(InternalSTTMessage::ServerError(err.clone()));
            (StatusCode::INTERNAL_SERVER_ERROR, err)
        });
        let InternalSTTArgs {
            model, model_path, ..
        } = args;

        let router = Router::new()
            .route_service(anlg_transcribe_gguf_local::LISTEN_PATH, service)
            .layer(
                CorsLayer::new()
                    .allow_origin(cors::Any)
                    .allow_methods(cors::Any)
                    .allow_headers(cors::Any),
            );

        let listener =
            tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).await?;

        let server_addr = listener.local_addr()?;
        let base_url = format!("http://{}/v1", server_addr);

        let (shutdown_tx, mut shutdown_rx) = tokio::sync::watch::channel(());

        let server_task = tokio::spawn(async move {
            axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    shutdown_rx.changed().await.ok();
                })
                .await
                .unwrap();
        });

        Ok(InternalSTTState {
            base_url,
            model,
            model_path,
            shutdown: shutdown_tx,
            server_task,
        })
    }

    async fn post_stop(
        &self,
        _myself: ActorRef<Self::Msg>,
        state: &mut Self::State,
    ) -> Result<(), ActorProcessingErr> {
        let _ = state.shutdown.send(());
        state.server_task.abort();
        Ok(())
    }

    async fn handle(
        &self,
        _myself: ActorRef<Self::Msg>,
        message: Self::Msg,
        state: &mut Self::State,
    ) -> Result<(), ActorProcessingErr> {
        match message {
            InternalSTTMessage::ServerError(e) => Err(e.into()),
            InternalSTTMessage::GetHealth(reply_port) => {
                let info = ServerInfo {
                    url: Some(state.base_url.clone()),
                    status: ServerStatus::Ready,
                    model: state.model.clone(),
                    custom_model_path: state
                        .model
                        .is_none()
                        .then(|| state.model_path.to_string_lossy().into_owned()),
                };

                if let Err(e) = reply_port.send(info) {
                    return Err(e.into());
                }

                Ok(())
            }
        }
    }
}
