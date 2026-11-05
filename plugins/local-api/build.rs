const COMMANDS: &[&str] = &[
    "list_webhooks",
    "create_webhook",
    "delete_webhook",
    "set_webhook_active",
    "test_webhook",
    "dispatch_event",
    "export_meeting_markdown",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
