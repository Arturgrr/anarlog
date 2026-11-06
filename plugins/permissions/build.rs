const COMMANDS: &[&str] = &[
    "open_permission",
    "check_permission",
    "request_permission",
    "reset_permission",
    "permission_guidance",
    "close_permission_assistant",
    "set_permission_assistant_labels",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
