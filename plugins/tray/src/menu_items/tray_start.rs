use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use tauri::{
    AppHandle, Result,
    menu::{MenuItem, MenuItemKind},
};

use super::MenuItemHandler;

static PENDING_START: Mutex<Option<Instant>> = Mutex::new(None);
// Long enough to unlock the app after the fallback shows it, short enough that
// opening it much later does not start a meeting nobody asked for any more.
const PENDING_START_TTL: Duration = Duration::from_secs(120);
const DELIVERY_TIMEOUT: Duration = Duration::from_secs(3);
const REBUILD_TIMEOUT: Duration = Duration::from_secs(15);
const DELIVERY_POLL: Duration = Duration::from_millis(250);

pub struct TrayStart;

impl MenuItemHandler for TrayStart {
    const ID: &'static str = "anlg_tray_start";

    fn build(app: &AppHandle<tauri::Wry>) -> Result<MenuItemKind<tauri::Wry>> {
        let item = MenuItem::with_id(
            app,
            Self::ID,
            crate::labels::labels().start_meeting,
            true,
            None::<&str>,
        )?;
        Ok(MenuItemKind::MenuItem(item))
    }

    // The main window keeps running its frontend while hidden, so it can start
    // the recording without coming forward. It cannot while it is being rebuilt
    // or before the app lock was first passed; showing it then lets it start
    // the recording once it has loaded or been unlocked.
    fn handle(app: &AppHandle<tauri::Wry>) {
        *PENDING_START.lock().unwrap() = Some(Instant::now());
        emit_start(app);

        let app = app.clone();
        std::thread::spawn(move || {
            let started = Instant::now();
            loop {
                std::thread::sleep(DELIVERY_POLL);
                if !has_pending_start() {
                    return;
                }
                let elapsed = started.elapsed();
                if elapsed >= REBUILD_TIMEOUT
                    || (elapsed >= DELIVERY_TIMEOUT
                        && !tauri_plugin_windows::main_window_rebuilding())
                {
                    break;
                }
            }

            use tauri_plugin_windows::{AppWindow, WindowsPluginExt};
            tracing::warn!("main window did not take the menu bar start; showing it");
            match app.windows().show(AppWindow::Main) {
                Ok(_) => emit_start(&app),
                Err(error) => {
                    tracing::error!(%error, "failed to show main window for the menu bar start")
                }
            }
        });
    }
}

fn emit_start(app: &AppHandle<tauri::Wry>) {
    use tauri_plugin_windows::{OpenTab, SessionsState, TabInput};
    use tauri_specta::Event;

    let event = OpenTab {
        tab: TabInput::Sessions {
            id: "new".to_string(),
            state: Some(SessionsState {
                view: Default::default(),
                auto_start: Some(true),
            }),
        },
    };
    if let Err(error) = event.emit(app) {
        tracing::warn!(%error, "failed to emit the menu bar start");
    }
}

fn has_pending_start() -> bool {
    PENDING_START.lock().unwrap().is_some()
}

impl TrayStart {
    pub fn build_with_disabled(
        app: &AppHandle<tauri::Wry>,
        disabled: bool,
    ) -> Result<MenuItem<tauri::Wry>> {
        MenuItem::with_id(
            app,
            Self::ID,
            crate::labels::labels().start_meeting,
            !disabled,
            None::<&str>,
        )
    }

    pub fn take_pending_start() -> bool {
        take_pending_start_at(&PENDING_START, Instant::now())
    }
}

fn take_pending_start_at(pending: &Mutex<Option<Instant>>, now: Instant) -> bool {
    pending
        .lock()
        .unwrap()
        .take()
        .is_some_and(|requested| now.saturating_duration_since(requested) < PENDING_START_TTL)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_menu_bar_start_is_taken_once_and_expires() {
        let pending = Mutex::new(None);
        let now = Instant::now();

        *pending.lock().unwrap() = Some(now);
        assert!(take_pending_start_at(&pending, now));
        assert!(!take_pending_start_at(&pending, now));

        *pending.lock().unwrap() = Some(now);
        assert!(!take_pending_start_at(&pending, now + PENDING_START_TTL));
    }
}
