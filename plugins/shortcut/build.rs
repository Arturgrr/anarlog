const COMMANDS: &[&str] = &[
    "register_hotkey",
    "unregister_hotkey",
    "configure",
    "validate",
    "set_active",
    "configure_paste_last",
    "validate_paste_last",
    "configure_annotate",
    "validate_annotate",
    "set_annotate_recording",
    "configure_capture",
    "validate_capture",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
