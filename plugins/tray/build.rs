const COMMANDS: &[&str] = &[
    "set_tray_icon_visible",
    "set_tray_recording_title",
    "set_tray_labels",
    "set_tray_paste_last_visible",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
