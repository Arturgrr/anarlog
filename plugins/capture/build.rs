const COMMANDS: &[&str] = &[
    "status",
    "screenshot",
    "start_recording",
    "stop_recording",
    "cancel_recording",
    "list_captures",
    "delete_capture",
    "copy_capture",
    "save_capture_as",
    "save_edited",
    "show_card",
    "close_cards",
    "system_shortcuts",
    "replace_system_shortcuts",
    "restore_system_shortcuts",
    "export_png",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
