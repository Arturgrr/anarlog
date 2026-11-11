const COMMANDS: &[&str] = &[
    "register_hotkey",
    "unregister_hotkey",
    "configure",
    "validate",
    "set_active",
    "configure_paste_last",
    "validate_paste_last",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
