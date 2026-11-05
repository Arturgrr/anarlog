const COMMANDS: &[&str] = &[
    "hud",
    "start_recording",
    "start_system_recording",
    "stop_recording",
    "cancel_recording",
    "discard_recording",
    "capture_target",
    "insert_text",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
