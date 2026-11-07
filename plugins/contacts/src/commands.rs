use tauri::Manager;

macro_rules! contacts_command {
    ($name:ident, $request:ty, $call:expr) => {
        #[tauri::command]
        #[specta::specta]
        pub async fn $name<R: tauri::Runtime>(
            app: tauri::AppHandle<R>,
            request: $request,
        ) -> Result<(), String> {
            let runtime = app
                .try_state::<tauri_plugin_db::ManagedState>()
                .map(|state| state.inner().clone())
                .ok_or_else(|| "database is not ready yet".to_string())?;
            $call(runtime.pool(), request).await
        }
    };
}

contacts_command!(
    create_human,
    crate::contacts::CreateHumanRequest,
    crate::contacts::create_human
);
contacts_command!(
    create_organization,
    crate::contacts::CreateOrganizationRequest,
    crate::contacts::create_organization
);
contacts_command!(
    update_human,
    crate::contacts::UpdateHumanRequest,
    crate::contacts::update_human
);
contacts_command!(
    update_organization,
    crate::contacts::UpdateOrganizationRequest,
    crate::contacts::update_organization
);
contacts_command!(
    soft_delete_contact,
    crate::contacts::SoftDeleteContactRequest,
    crate::contacts::soft_delete_contact
);
contacts_command!(
    update_contact_avatar,
    crate::contacts::UpdateContactAvatarRequest,
    crate::contacts::update_contact_avatar
);
contacts_command!(
    update_human_contact_summary,
    crate::contacts::UpdateHumanContactSummaryRequest,
    crate::contacts::update_human_contact_summary
);
contacts_command!(
    toggle_contact_pin,
    crate::contacts::ToggleContactPinRequest,
    crate::contacts::toggle_contact_pin
);
contacts_command!(
    reorder_pinned_contacts,
    crate::contacts::ReorderPinnedContactsRequest,
    crate::contacts::reorder_pinned_contacts
);
contacts_command!(
    merge_humans,
    crate::contacts::MergeHumansRequest,
    crate::contacts::merge_humans
);
