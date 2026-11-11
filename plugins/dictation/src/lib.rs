mod commands;
mod environment;
mod error;
mod events;
mod ext;
mod handler;
mod history;
mod insertion;
mod preview;
mod recorder;
mod target_app;

pub use error::*;
pub use events::*;
pub use ext::*;

use handler::Handler;
use recorder::Recorder;
use tauri::Manager;

const PLUGIN_NAME: &str = "dictation";

fn make_specta_builder<R: tauri::Runtime>() -> tauri_specta::Builder<R> {
    tauri_specta::Builder::<R>::new()
        .plugin_name(PLUGIN_NAME)
        .commands(tauri_specta::collect_commands![
            commands::hud::<tauri::Wry>,
            commands::start_recording::<tauri::Wry>,
            commands::start_system_recording::<tauri::Wry>,
            commands::stop_recording::<tauri::Wry>,
            commands::cancel_recording::<tauri::Wry>,
            commands::discard_recording::<tauri::Wry>,
            commands::check_insertion,
            commands::insert_text,
            commands::frontmost_app,
            commands::keep_history_audio::<tauri::Wry>,
            commands::history_audio_path::<tauri::Wry>,
            commands::delete_history_audio::<tauri::Wry>,
            commands::prune_history_audio::<tauri::Wry>,
            commands::request_media_control,
        ])
        .error_handling(tauri_specta::ErrorHandlingMode::Result)
}

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let specta_builder = make_specta_builder();

    tauri::plugin::Builder::new(PLUGIN_NAME)
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app, _api| {
            app.manage(Handler::new(app.clone()));
            app.manage(Recorder::new());
            match app.path().app_data_dir() {
                Ok(directory) => anlg_recording_environment::recover(directory),
                Err(error) => {
                    tracing::warn!(%error, "dictation cannot restore audio a previous run left quiet")
                }
            }
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
