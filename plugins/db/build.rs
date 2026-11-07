const COMMANDS: &[&str] = &[
    "execute",
    "execute_proxy",
    "execute_transaction",
    "get_meeting",
    "get_meeting_transcript",
    "get_recurring_meeting_history",
    "get_legacy_cleanup_status",
    "get_legacy_import_report",
    "cleanup_recording_imports",
    "list_meetings",
    "cleanup_legacy_files",
    "run_legacy_import",
    "apply_session_ingest",
    "subscribe",
    "unsubscribe",
    "get_startup_status",
    "wait_until_ready",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
