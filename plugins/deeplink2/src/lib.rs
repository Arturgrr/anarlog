mod commands;
mod error;
pub mod server;
mod types;

pub use error::{Error, Result};
pub use types::{AuthCallbackSearch, DeepLink, DeepLinkEvent};

use std::str::FromStr;

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_specta::Event;

const PLUGIN_NAME: &str = "deeplink2";

fn redact_url(url_str: &str) -> String {
    match url::Url::parse(url_str) {
        Ok(parsed) => {
            let scheme = parsed.scheme();
            let host = parsed.host_str().unwrap_or("");
            let path = parsed.path();
            format!("{}://{}{}", scheme, host, path)
        }
        Err(_) => "[invalid_url]".to_string(),
    }
}

fn make_specta_builder<R: tauri::Runtime>() -> tauri_specta::Builder<R> {
    tauri_specta::Builder::<R>::new()
        .plugin_name(PLUGIN_NAME)
        .commands(tauri_specta::collect_commands![
            commands::start_callback_server::<tauri::Wry>,
            commands::stop_callback_server::<tauri::Wry>,
        ])
        .events(tauri_specta::collect_events![types::DeepLinkEvent])
        .typ::<types::DeepLink>()
        .error_handling(tauri_specta::ErrorHandlingMode::Result)
}

fn process_url<R: Runtime>(app_handle: &AppHandle<R>, url: &url::Url) {
    let url_str = url.as_str();
    let redacted = redact_url(url_str);
    tracing::info!(url = %redacted, "deeplink_received");

    match DeepLink::from_str(url_str) {
        Ok(deep_link) => {
            tracing::info!(path = deep_link.path(), "deeplink_parsed");
            if let Err(error) = DeepLinkEvent(deep_link).emit(app_handle) {
                tracing::error!(?error, "deeplink_event_emit_failed");
            }
        }
        Err(error) => {
            tracing::debug!(?error, url = %redacted, "deeplink_parse_failed");
        }
    }
}

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let specta_builder = make_specta_builder();

    tauri::plugin::Builder::new(PLUGIN_NAME)
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app, _api| {
            specta_builder.mount_events(app);
            app.manage(server::CallbackServerState::new());

            let app_handle = app.clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    process_url(&app_handle, &url);
                }
            });

            Ok(())
        })
        .build()
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn export() {
        export_types();
    }

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

    #[test]
    fn redacts_query_and_fragment_from_logged_urls() {
        let value = redact_url("librelog://auth/callback?code=secret-code&state=s1#secret");
        assert_eq!(value, "librelog://auth/callback");
    }
}
