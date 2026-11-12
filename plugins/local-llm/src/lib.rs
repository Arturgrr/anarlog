//! Built-in language models: downloads the catalog's GGUF files and runs the
//! bundled llama-server with one of them on 127.0.0.1, for the app's
//! OpenAI-compatible "Built-in models" provider.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use anlg_local_llm::{ServerConfig, ServerManager};
use anlg_model_downloader::ModelDownloadManager;
use tauri::{Manager, Wry};
use tauri_specta::Event;

mod binary;
mod commands;
mod error;
mod ext;
mod types;

pub use anlg_local_llm::{Admission, Endpoint, Fit, LlmModel, ServerState};
pub use binary::{SERVER_NAME, SERVER_OVERRIDE_ENV};
pub use error::{LlmError, LlmErrorKind};
pub use ext::{LocalLlm, LocalLlmPluginExt, State};
pub use types::*;

const PLUGIN_NAME: &str = "local-llm";

pub type CaptureActiveFn<R> = fn(tauri::AppHandle<R>) -> Pin<Box<dyn Future<Output = bool> + Send>>;

pub struct InitOptions<R: tauri::Runtime> {
    /// Whether a meeting is being recorded right now; small-memory Macs do
    /// not load a model then.
    pub capture_active: Option<CaptureActiveFn<R>>,
}

impl<R: tauri::Runtime> Default for InitOptions<R> {
    fn default() -> Self {
        Self {
            capture_active: None,
        }
    }
}

fn make_specta_builder<R: tauri::Runtime>() -> tauri_specta::Builder<R> {
    tauri_specta::Builder::<R>::new()
        .plugin_name(PLUGIN_NAME)
        .commands(tauri_specta::collect_commands![
            commands::runtime_status::<Wry>,
            commands::list_models::<Wry>,
            commands::models_dir::<Wry>,
            commands::download_model::<Wry>,
            commands::cancel_download::<Wry>,
            commands::delete_model::<Wry>,
            commands::is_model_downloading::<Wry>,
            commands::ensure_server::<Wry>,
            commands::stop_server::<Wry>,
            commands::server_state::<Wry>,
        ])
        .events(tauri_specta::collect_events![
            LlmDownloadProgress,
            LlmServerStateChanged,
        ])
        .error_handling(tauri_specta::ErrorHandlingMode::Result)
}

pub fn init<R: tauri::Runtime>(options: InitOptions<R>) -> tauri::plugin::TauriPlugin<R> {
    let specta_builder = make_specta_builder();

    tauri::plugin::Builder::new(PLUGIN_NAME)
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app, _api| {
            specta_builder.mount_events(app);

            use tauri_plugin_settings::SettingsPluginExt;
            let base = app
                .settings()
                .global_base()
                .map(|base| base.into_std_path_buf())
                .unwrap_or_else(|_| dirs::data_dir().unwrap_or_default());
            let models_base = base.join("models");

            let server = binary::resolve().map(|binary| {
                let handle = app.clone();
                ServerManager::new(
                    ServerConfig::new(binary, base.join("local-llm")),
                    move |state| {
                        let _ = LlmServerStateChanged {
                            state: state.clone(),
                        }
                        .emit(&handle);
                    },
                )
            });
            match &server {
                Ok(server) => {
                    let server = server.clone();
                    tauri::async_runtime::spawn_blocking(move || server.reap_stale());
                }
                Err(reason) => tracing::info!(?reason, "built_in_models_unavailable"),
            }

            let downloader = ModelDownloadManager::new(Arc::new(ext::DownloadRuntime {
                app: app.clone(),
                models_base: models_base.clone(),
            }));
            let capture_active = options.capture_active.map(|probe| {
                let app = app.clone();
                Arc::new(move || probe(app.clone())) as ext::CaptureProbe
            });

            app.manage(State {
                downloader,
                server,
                models_base,
                capture_active,
            });
            Ok(())
        })
        .on_event(|app, event| {
            if let tauri::RunEvent::Exit = event
                && let Some(state) = app.try_state::<State>()
                && let Ok(server) = &state.server
            {
                server.shutdown_blocking();
            }
        })
        .build()
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn export_types() {
        const OUTPUT_FILE: &str = "./js/bindings.gen.ts";

        make_specta_builder::<tauri::Wry>()
            .export(
                specta_typescript::Typescript::default()
                    .formatter(specta_typescript::formatter::prettier)
                    .bigint(specta_typescript::BigIntExportBehavior::Number),
                OUTPUT_FILE,
            )
            .unwrap();

        let content = std::fs::read_to_string(OUTPUT_FILE).unwrap();
        std::fs::write(OUTPUT_FILE, format!("// @ts-nocheck\n{content}")).unwrap();
    }
}
