const COMMANDS: &[&str] = &[
    "authorization_status",
    "request_full_access",
    "list_todo_lists",
    "fetch_todos",
    "read_path",
    "create_todo",
    "complete_todo",
    "delete_todo",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
