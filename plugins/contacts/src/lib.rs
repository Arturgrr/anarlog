mod commands;
mod contacts;
mod storage;

const PLUGIN_NAME: &str = "contacts";

fn make_specta_builder<R: tauri::Runtime>() -> tauri_specta::Builder<R> {
    tauri_specta::Builder::<R>::new()
        .plugin_name(PLUGIN_NAME)
        .commands(tauri_specta::collect_commands![
            commands::create_human::<tauri::Wry>,
            commands::create_organization::<tauri::Wry>,
            commands::save_personal_contact::<tauri::Wry>,
            commands::update_human::<tauri::Wry>,
            commands::update_organization::<tauri::Wry>,
            commands::soft_delete_contact::<tauri::Wry>,
            commands::update_contact_avatar::<tauri::Wry>,
            commands::update_human_contact_summary::<tauri::Wry>,
            commands::toggle_contact_pin::<tauri::Wry>,
            commands::reorder_pinned_contacts::<tauri::Wry>,
            commands::merge_humans::<tauri::Wry>,
        ])
        .error_handling(tauri_specta::ErrorHandlingMode::Result)
}

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let specta_builder = make_specta_builder();

    tauri::plugin::Builder::new(PLUGIN_NAME)
        .invoke_handler(specta_builder.invoke_handler())
        .build()
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn export_types() {
        const OUTPUT_FILE: &str = "./js/bindings.gen.ts";

        make_specta_builder::<tauri::Wry>()
            .export(
                specta_typescript::Typescript::default()
                    .formatter(specta_typescript::formatter::prettier)
                    .bigint(specta_typescript::BigIntExportBehavior::Number),
                OUTPUT_FILE,
            )
            .unwrap();

        let content = std::fs::read_to_string(OUTPUT_FILE).unwrap();
        std::fs::write(OUTPUT_FILE, format!("// @ts-nocheck\n{content}")).unwrap();
    }
}
