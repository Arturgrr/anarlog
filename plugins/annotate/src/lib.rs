//! Annotate: record the screen while drawing over it in red and talking,
//! then turn it into a bundle a coding agent reads (`anlg_annotate_core`). This
//! plugin owns the recording session and the narration; the frontend drives
//! it and transcribes the narration in between `stop` and `finalize`.

mod audio;
mod bundle;
mod commands;
mod error;
mod events;
mod native;
mod session;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

pub use error::*;
pub use events::*;

use tauri::Manager;
use tauri_specta::Event;

use session::Session;

const PLUGIN_NAME: &str = "annotate";
const RETENTION_EVERY: Duration = Duration::from_secs(60 * 60);

async fn blocking_native<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, anlg_annotate_macos::AnnotateError> + Send + 'static,
) -> Result<T, Error> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| Error::Task(error.to_string()))?
        .map_err(Error::from)
}

fn make_specta_builder<R: tauri::Runtime>() -> tauri_specta::Builder<R> {
    tauri_specta::Builder::<R>::new()
        .plugin_name(PLUGIN_NAME)
        .commands(tauri_specta::collect_commands![
            commands::screen_recording::<tauri::Wry>,
            commands::request_screen_recording::<tauri::Wry>,
            commands::open_screen_recording_settings::<tauri::Wry>,
            commands::start::<tauri::Wry>,
            commands::stop::<tauri::Wry>,
            commands::finalize::<tauri::Wry>,
            commands::cancel::<tauri::Wry>,
            commands::set_ink_mode::<tauri::Wry>,
            commands::status::<tauri::Wry>,
            commands::set_retention::<tauri::Wry>,
            commands::annotations_dir::<tauri::Wry>,
            commands::latest::<tauri::Wry>,
        ])
        .events(tauri_specta::collect_events![AnnotateEvent])
        .error_handling(tauri_specta::ErrorHandlingMode::Result)
}

/// `root` holds the annotations, one folder each; without one they go in
/// the app data directory's `annotations`.
pub fn init(root: Option<PathBuf>) -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let specta_builder = make_specta_builder();

    tauri::plugin::Builder::new(PLUGIN_NAME)
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app, _api| {
            specta_builder.mount_events(app);
            let root = match root {
                Some(root) => root,
                None => app.path().app_data_dir()?.join("annotations"),
            };
            let emitter = app.clone();
            let session = Arc::new(Session::new(
                Arc::new(native::System),
                Arc::new(audio::HostClock),
                root,
                Arc::new(move |event: AnnotateEvent| {
                    let _ = event.emit(&emitter);
                }),
            ));
            app.manage(session.clone());
            tauri::async_runtime::spawn(async move {
                let mut every = tokio::time::interval(RETENTION_EVERY);
                every.tick().await;
                loop {
                    every.tick().await;
                    session.run_retention().await;
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
