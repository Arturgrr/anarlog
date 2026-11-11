const COMMANDS: &[&str] = &[
    "hud",
    "start_recording",
    "start_system_recording",
    "stop_recording",
    "cancel_recording",
    "discard_recording",
    "capture_target",
    "insert_text",
    "frontmost_app",
    "keep_history_audio",
    "history_audio_path",
    "delete_history_audio",
    "prune_history_audio",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
