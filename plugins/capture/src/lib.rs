//! Capture: screenshots, screen recordings (MP4) and GIFs, the cards they
//! leave in the screen's corner, and the option to turn macOS's own
//! screenshot shortcuts off. This plugin owns names and destinations, the
//! index of recent captures, thumbnails, GIF conversion, copying, cards and
//! the native event poll; the frontend maps shortcuts and settings to its
//! commands. The native layer is `anlg_annotate_macos::capture`.

mod commands;
mod error;
mod events;
mod export;
mod library;
mod native;
mod process;
mod session;
mod system;
mod types;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

pub use error::*;
pub use events::*;
pub use types::*;

use anlg_capture_core::Layout;
use tauri::Manager;
use tauri_specta::Event;

use session::Session;

const PLUGIN_NAME: &str = "capture";
/// How long quitting waits to keep a recording (or cancel a selector):
/// inside the app's 10 s wait for the frontend and its 12 s hard exit.
const SHUTDOWN_WITHIN: Duration = Duration::from_secs(9);

/// Closes the cards and cancels whatever selects or records, for an app
/// that is quitting; returns at once when nothing does or Capture isn't
/// running. Await it before exiting, off the main thread: the native layer
/// closes its windows there.
pub async fn shutdown<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(session) = app.try_state::<Arc<Session>>() else {
        return;
    };
    let session = session.inner().clone();
    session.shutdown(SHUTDOWN_WITHIN).await;
}

fn make_specta_builder<R: tauri::Runtime>() -> tauri_specta::Builder<R> {
    tauri_specta::Builder::<R>::new()
        .plugin_name(PLUGIN_NAME)
        .commands(tauri_specta::collect_commands![
            commands::status::<tauri::Wry>,
            commands::screenshot::<tauri::Wry>,
            commands::start_recording::<tauri::Wry>,
            commands::stop_recording::<tauri::Wry>,
            commands::cancel_recording::<tauri::Wry>,
            commands::list_captures::<tauri::Wry>,
            commands::delete_capture::<tauri::Wry>,
            commands::copy_capture::<tauri::Wry>,
            commands::save_capture_as::<tauri::Wry>,
            commands::save_edited::<tauri::Wry>,
            commands::show_card::<tauri::Wry>,
            commands::close_cards::<tauri::Wry>,
            commands::system_shortcuts::<tauri::Wry>,
            commands::replace_system_shortcuts::<tauri::Wry>,
            commands::restore_system_shortcuts::<tauri::Wry>,
            export::export_png,
        ])
        .events(tauri_specta::collect_events![CaptureEvent])
        .error_handling(tauri_specta::ErrorHandlingMode::Result)
}

/// `root` holds the captures index, the library and the thumbnails; without
/// one it is the app data directory's `captures`.
pub fn init(root: Option<PathBuf>) -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let specta_builder = make_specta_builder();

    tauri::plugin::Builder::new(PLUGIN_NAME)
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app, _api| {
            specta_builder.mount_events(app);
            let root = match root {
                Some(root) => root,
                None => app.path().app_data_dir()?.join("captures"),
            };
            let emitter = app.clone();
            let session = Arc::new(Session::new(
                Arc::new(native::System),
                Layout::new(root),
                app.path().download_dir().ok(),
                Arc::new(move |event: CaptureEvent| {
                    let _ = event.emit(&emitter);
                }),
            ));
            app.manage(session);
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests;

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
