const COMMANDS: &[&str] = &[
    "create_human",
    "create_organization",
    "save_personal_contact",
    "update_human",
    "update_organization",
    "soft_delete_contact",
    "update_contact_avatar",
    "update_human_contact_summary",
    "toggle_contact_pin",
    "reorder_pinned_contacts",
    "merge_humans",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
