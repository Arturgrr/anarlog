use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;

use anlg_local_llm::{Endpoint, LaunchRequest, LlmModel, ServerManager, ServerState, admission};
use anlg_model_downloader::{DownloadStatus, ModelDownloadManager, ModelDownloaderRuntime};
use tauri::{Manager, Runtime};
use tauri_specta::Event;

use crate::{
    LlmDownloadProgress, LlmError, LlmErrorKind, LlmModelEntry, LlmModelLicense, RuntimeStatus,
    UnavailableReason,
};

pub type CaptureProbe = Arc<dyn Fn() -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync>;

pub struct State {
    pub(crate) downloader: ModelDownloadManager<LlmModel>,
    pub(crate) server: Result<ServerManager, UnavailableReason>,
    pub(crate) models_base: PathBuf,
    pub(crate) capture_active: Option<CaptureProbe>,
}

pub(crate) struct DownloadRuntime<R: Runtime> {
    pub(crate) app: tauri::AppHandle<R>,
    pub(crate) models_base: PathBuf,
}

impl<R: Runtime> ModelDownloaderRuntime<LlmModel> for DownloadRuntime<R> {
    fn models_base(&self) -> Result<PathBuf, anlg_model_downloader::Error> {
        Ok(self.models_base.clone())
    }

    fn emit_progress(&self, model: &LlmModel, status: DownloadStatus) {
        let _ = LlmDownloadProgress {
            model: *model,
            status,
        }
        .emit(&self.app);
    }
}

pub struct LocalLlm<'a, R: Runtime, M: Manager<R>> {
    manager: &'a M,
    _runtime: std::marker::PhantomData<fn() -> R>,
}

impl<'a, R: Runtime, M: Manager<R>> LocalLlm<'a, R, M> {
    fn state(&self) -> tauri::State<'a, State> {
        self.manager.state::<State>()
    }

    fn server(&self) -> Result<ServerManager, LlmError> {
        self.state().server.clone().map_err(|_| {
            LlmError::new(
                LlmErrorKind::Unavailable,
                "Built-in models are not available in this build.",
            )
        })
    }

    pub fn runtime_status(&self) -> RuntimeStatus {
        let reason = self.state().server.as_ref().err().copied();
        RuntimeStatus {
            available: reason.is_none(),
            reason,
            total_memory_bytes: admission::total_memory_bytes(),
        }
    }

    pub fn models_dir(&self) -> PathBuf {
        self.state().models_base.join("llm")
    }

    pub async fn list_models(&self) -> Vec<LlmModelEntry> {
        let total_memory = admission::total_memory_bytes();
        let best = admission::best_for(total_memory);
        let mut entries = Vec::with_capacity(LlmModel::ALL.len());
        for model in LlmModel::ALL.iter().copied() {
            let info = model.info();
            entries.push(LlmModelEntry {
                id: model,
                display_name: info.display_name.to_string(),
                size_bytes: info.artifact.bytes,
                context_length: info.context_length,
                license: LlmModelLicense {
                    name: info.license.name.to_string(),
                    url: info.license.url.to_string(),
                    attribution: info.license.attribution.to_string(),
                },
                source_url: info.artifact.source_url(),
                downloaded: self.is_downloaded(model).await,
                downloading: self.state().downloader.is_downloading(&model).await,
                admission: admission::admit(model, total_memory),
                best: best == Some(model),
                default: model == LlmModel::DEFAULT,
            });
        }
        entries
    }

    async fn is_downloaded(&self, model: LlmModel) -> bool {
        self.state()
            .downloader
            .is_downloaded(&model)
            .await
            .unwrap_or(false)
    }

    pub async fn download_model(&self, model: LlmModel) -> Result<(), LlmError> {
        self.server()?;
        self.ensure_intelligence_enabled().await?;
        Ok(self.state().downloader.download(&model).await?)
    }

    pub async fn cancel_download(&self, model: LlmModel) -> Result<bool, LlmError> {
        Ok(self.state().downloader.cancel_download(&model).await?)
    }

    pub async fn is_model_downloading(&self, model: LlmModel) -> bool {
        self.state().downloader.is_downloading(&model).await
    }

    pub async fn delete_model(&self, model: LlmModel) -> Result<(), LlmError> {
        if let Ok(server) = self.server()
            && server_model(&server.state()) == Some(model.as_str())
        {
            server.stop().await;
        }
        Ok(self.state().downloader.delete(&model).await?)
    }

    /// Starts the server with `model` unless it already runs it, after the
    /// checks a request must pass: the platform, the managed intelligence
    /// switch, the download, memory, and a recording on a small Mac.
    pub async fn ensure_server(&self, model: LlmModel) -> Result<Endpoint, LlmError> {
        let server = self.server()?;
        self.ensure_intelligence_enabled().await?;
        if !self.is_downloaded(model).await {
            return Err(LlmError::new(
                LlmErrorKind::NotDownloaded,
                format!("{} is not downloaded.", model.info().display_name),
            ));
        }

        let total_memory = admission::total_memory_bytes();
        let admission = admission::admit(model, total_memory);
        let Some(context) = admission.context else {
            return Err(LlmError::new(
                LlmErrorKind::TooLarge,
                format!(
                    "{} needs about {:.1} GB of memory; this computer has {:.1} GB.",
                    model.info().display_name,
                    admission.estimate_bytes as f64 / 1e9,
                    total_memory as f64 / 1e9
                ),
            ));
        };

        // A model already loaded keeps serving; only loading one waits for
        // the recording to end.
        let loaded = matches!(
            server.state(),
            ServerState::Ready { model: ref running, context: ready } if running == model.as_str() && ready == context
        );
        if !loaded && total_memory <= admission::SMALL_MEMORY_BYTES && self.capture_active().await {
            return Err(LlmError::new(
                LlmErrorKind::CaptureActive,
                "This Mac needs its memory for transcription while it records. The built-in model starts after the recording ends.",
            ));
        }

        let model_path = self.state().models_base.join(model.relative_path());
        Ok(server
            .ensure(LaunchRequest {
                model: model.as_str().to_string(),
                model_path,
                context,
            })
            .await?)
    }

    pub async fn stop_server(&self) {
        if let Ok(server) = self.server() {
            server.stop().await;
        }
    }

    pub fn server_state(&self) -> ServerState {
        self.server()
            .map(|server| server.state())
            .unwrap_or(ServerState::Stopped)
    }

    async fn capture_active(&self) -> bool {
        let probe = self.state().capture_active.clone();
        match probe {
            Some(probe) => probe().await,
            None => false,
        }
    }

    async fn ensure_intelligence_enabled(&self) -> Result<(), LlmError> {
        let Some(db) = self.manager.try_state::<tauri_plugin_db::ManagedState>() else {
            return Ok(());
        };
        let disabled: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM managed_app_settings WHERE id = 'intelligence_disabled' AND value_json = 'true') \
             OR EXISTS(SELECT 1 FROM app_settings WHERE id = 'intelligence_disabled' AND value_json = 'true')",
        )
        .fetch_one(db.pool())
        .await
        .map_err(|error| LlmError::other(format!("Could not read the intelligence setting: {error}")))?;
        if disabled {
            return Err(LlmError::new(
                LlmErrorKind::IntelligenceDisabled,
                "Intelligence is turned off by your organization.",
            ));
        }
        Ok(())
    }
}

fn server_model(state: &ServerState) -> Option<&str> {
    match state {
        ServerState::Starting { model }
        | ServerState::Ready { model, .. }
        | ServerState::Failed { model, .. } => Some(model),
        ServerState::Stopped => None,
    }
}

pub trait LocalLlmPluginExt<R: Runtime> {
    fn local_llm(&self) -> LocalLlm<'_, R, Self>
    where
        Self: Manager<R> + Sized;
}

impl<R: Runtime, T: Manager<R>> LocalLlmPluginExt<R> for T {
    fn local_llm(&self) -> LocalLlm<'_, R, Self>
    where
        Self: Sized,
    {
        LocalLlm {
            manager: self,
            _runtime: std::marker::PhantomData,
        }
    }
}
