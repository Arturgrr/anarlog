use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

use crate::{ShortcutEvent, ShortcutPluginExt, press};

pub fn uses_portal() -> bool {
    cfg!(target_os = "linux") && std::env::var_os("WAYLAND_DISPLAY").is_some()
}

#[derive(Default)]
pub struct GlobalState {
    registration: tokio::sync::Mutex<Registration>,
    active: Arc<AtomicBool>,
}

#[derive(Default)]
struct Registration {
    shortcuts: Vec<Shortcut>,
    cancel_keys: Vec<Shortcut>,
    #[cfg(target_os = "linux")]
    portal: Option<portal::Registration>,
}

/// The configured shortcuts, each paired with its position in the list and
/// registered once.
#[derive(Default)]
struct Plan {
    #[cfg(target_os = "macos")]
    native: Vec<(usize, anlg_shortcut_macos::Trigger)>,
    accelerators: Vec<(usize, Shortcut)>,
}

type GlobalShortcut = tauri_plugin_global_shortcut::GlobalShortcut<tauri::Wry>;

/// Registers every shortcut in `shortcuts`; any of them starts and stops
/// dictation. An empty list unregisters them all. If one cannot be
/// registered, none stay registered.
#[tauri::command]
#[specta::specta]
pub async fn configure(app: tauri::AppHandle, shortcuts: Vec<String>) -> Result<(), String> {
    let plan = plan(&shortcuts, app.try_state::<GlobalShortcut>().is_some())?;
    let state = app.state::<GlobalState>();
    let mut registration = state.registration.lock().await;
    state.active.store(false, Ordering::SeqCst);
    app.state::<press::Presses>().reset();
    unregister(&app, &mut registration).await?;

    let result = async {
        #[cfg(target_os = "macos")]
        if !plan.native.is_empty() {
            app.shortcut()
                .register_triggers(plan.native, state.active.clone())
                .map_err(|e| e.to_string())?;
        }
        if plan.accelerators.is_empty() {
            return Ok(());
        }
        #[cfg(target_os = "linux")]
        if uses_portal() {
            registration.portal = Some(portal::register(app.clone(), plan.accelerators).await?);
            return Ok(());
        }
        for (source, key) in plan.accelerators {
            app.global_shortcut()
                .on_shortcut(key, move |app, _, event| {
                    let event = if event.state == ShortcutState::Pressed {
                        ShortcutEvent::Pressed
                    } else {
                        ShortcutEvent::Released
                    };
                    press::emit(app, source, event);
                })
                .map_err(|e| {
                    format!(
                        "Could not register dictation shortcut. It may be used by another app: {e}"
                    )
                })?;
            registration.shortcuts.push(key);
        }
        Ok::<(), String>(())
    }
    .await;
    if result.is_err() {
        let _ = unregister(&app, &mut registration).await;
    }
    result
}

async fn unregister(app: &tauri::AppHandle, registration: &mut Registration) -> Result<(), String> {
    app.shortcut().unregister().map_err(|e| e.to_string())?;
    if let Some(global) = app.try_state::<GlobalShortcut>() {
        for keys in [&mut registration.cancel_keys, &mut registration.shortcuts] {
            while let Some(key) = keys.last().copied() {
                global.unregister(key).map_err(|e| e.to_string())?;
                keys.pop();
            }
        }
    }
    #[cfg(target_os = "linux")]
    if let Some(portal) = registration.portal.take() {
        portal.close().await;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_active(app: tauri::AppHandle, active: bool) -> Result<(), String> {
    let state = app.state::<GlobalState>();
    let mut registration = state.registration.lock().await;
    state.active.store(active, Ordering::SeqCst);
    if !active {
        app.state::<press::Presses>().reset();
    }
    #[cfg(target_os = "linux")]
    if uses_portal() {
        return Ok(());
    }
    let Some(global) = app.try_state::<GlobalShortcut>() else {
        return Ok(());
    };
    if active {
        let keys = std::iter::once(Shortcut::new(None, Code::Escape))
            .chain(
                registration
                    .shortcuts
                    .iter()
                    .map(|shortcut| Shortcut::new(Some(shortcut.mods), Code::Escape)),
            )
            .collect::<Vec<_>>();
        for key in keys {
            if registration.cancel_keys.contains(&key) {
                continue;
            }
            let enabled = state.active.clone();
            global
                .on_shortcut(key, move |app, _, event| {
                    if event.state == ShortcutState::Pressed && enabled.load(Ordering::SeqCst) {
                        press::cancel(app);
                    }
                })
                .map_err(|e| e.to_string())?;
            registration.cancel_keys.push(key);
        }
    } else {
        while let Some(key) = registration.cancel_keys.last().copied() {
            global.unregister(key).map_err(|e| e.to_string())?;
            registration.cancel_keys.pop();
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
mod portal;
#[cfg(any(target_os = "linux", test))]
mod trigger;

#[tauri::command]
#[specta::specta]
pub fn validate(app: tauri::AppHandle, shortcut: String) -> Result<(), String> {
    validate_shortcut(&shortcut, app.try_state::<GlobalShortcut>().is_some())
}

/// `DoubleTap+<KeyboardEvent.code>`: two quick taps of one modifier key.
const DOUBLE_TAP_PREFIX: &str = "DoubleTap+";

fn is_native(shortcut: &str) -> bool {
    matches!(shortcut, "Fn" | "RightCommand") || shortcut.starts_with(DOUBLE_TAP_PREFIX)
}

#[cfg(target_os = "macos")]
fn native_trigger(shortcut: &str) -> Option<anlg_shortcut_macos::Trigger> {
    use anlg_shortcut_macos::{HotKey, Modifier, Modifiers, Options, Trigger};
    if let Some(key) = double_tap_key(shortcut) {
        return Some(Trigger::DoubleTap(key));
    }
    let modifier = match shortcut {
        "Fn" => Modifier::Fn,
        "RightCommand" => Modifier::RightCommand,
        _ => return None,
    };
    Some(Trigger::HotKey {
        hotkey: HotKey::modifier_only(Modifiers::from([modifier])),
        options: Options {
            double_tap_lock_enabled: false,
            ..Default::default()
        },
    })
}

#[cfg(target_os = "macos")]
fn double_tap_key(shortcut: &str) -> Option<anlg_shortcut_macos::ModifierKey> {
    use anlg_shortcut_macos::ModifierKey;
    Some(match shortcut.strip_prefix(DOUBLE_TAP_PREFIX)? {
        "AltLeft" => ModifierKey::LeftOption,
        "AltRight" => ModifierKey::RightOption,
        "MetaLeft" => ModifierKey::LeftCommand,
        "MetaRight" => ModifierKey::RightCommand,
        "ControlLeft" => ModifierKey::LeftControl,
        "ControlRight" => ModifierKey::RightControl,
        "ShiftLeft" => ModifierKey::LeftShift,
        "ShiftRight" => ModifierKey::RightShift,
        _ => return None,
    })
}

fn validate_shortcut(shortcut: &str, global_available: bool) -> Result<(), String> {
    if shortcut.starts_with(DOUBLE_TAP_PREFIX) {
        if !cfg!(target_os = "macos") {
            return Err("Double-tap shortcuts are only available on macOS.".into());
        }
        #[cfg(target_os = "macos")]
        if double_tap_key(shortcut).is_none() {
            return Err(format!("Invalid dictation shortcut: {shortcut}"));
        }
        return Ok(());
    }
    if cfg!(target_os = "macos") && is_native(shortcut) {
        return Ok(());
    }
    let key = parse_shortcut(shortcut)?;
    if !uses_portal() && !global_available {
        return Err("Global shortcuts are unavailable in this desktop session.".into());
    }
    #[cfg(target_os = "linux")]
    if uses_portal() {
        trigger::portal_trigger(key)?;
    }
    let _ = key;
    Ok(())
}

fn plan(shortcuts: &[String], global_available: bool) -> Result<Plan, String> {
    let mut plan = Plan::default();
    for (source, shortcut) in shortcuts.iter().enumerate() {
        validate_shortcut(shortcut, global_available)?;
        #[cfg(target_os = "macos")]
        if let Some(trigger) = native_trigger(shortcut) {
            if !plan.native.iter().any(|(_, known)| *known == trigger) {
                plan.native.push((source, trigger));
            }
            continue;
        }
        let key = parse_shortcut(shortcut)?;
        if !plan.accelerators.iter().any(|(_, known)| *known == key) {
            plan.accelerators.push((source, key));
        }
    }
    Ok(plan)
}

fn parse_shortcut(shortcut: &str) -> Result<Shortcut, String> {
    let key: Shortcut = shortcut
        .parse()
        .map_err(|e| format!("Invalid dictation shortcut: {e}"))?;
    if key.mods.is_empty() {
        return Err("Choose a shortcut with Control, Alt, Shift, or Command.".into());
    }
    if key.key == Code::Escape {
        return Err("Escape is reserved for cancelling dictation. Choose another key.".into());
    }
    Ok(key)
}

#[cfg(test)]
mod validation_tests {
    use super::*;
    #[test]
    fn rejects_invalid_and_reserved_shortcuts_without_registering() {
        for shortcut in ["", "KeyD", "not-a-shortcut", "Control+Escape"] {
            assert!(validate_shortcut(shortcut, true).is_err());
        }
        assert!(validate_shortcut("Control+Alt+KeyD", true).is_ok());
        if !uses_portal() {
            assert!(validate_shortcut("Control+Alt+KeyD", false).is_err());
        }
        #[cfg(target_os = "macos")]
        assert!(validate_shortcut("Fn", false).is_ok());
        assert_eq!(
            validate_shortcut("DoubleTap+AltLeft", false).is_ok(),
            cfg!(target_os = "macos")
        );
        assert!(validate_shortcut("DoubleTap+KeyA", true).is_err());
    }

    #[test]
    fn plans_each_listed_shortcut_once_and_rejects_a_list_with_an_invalid_one() {
        let list = |items: &[&str]| items.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let sources =
            |items: &[(usize, Shortcut)]| items.iter().map(|(s, _)| *s).collect::<Vec<_>>();

        let accelerators = plan(
            &list(&["Control+Alt+KeyD", "Alt+Control+KeyD", "Shift+Alt+Space"]),
            true,
        )
        .unwrap()
        .accelerators;
        assert_eq!(sources(&accelerators), [0, 2]);
        assert!(plan(&list(&["Control+Alt+KeyD", "KeyD"]), true).is_err());

        #[cfg(target_os = "macos")]
        {
            let plan = plan(
                &list(&[
                    "DoubleTap+AltLeft",
                    "Control+Alt+KeyD",
                    "Fn",
                    "DoubleTap+AltLeft",
                ]),
                true,
            )
            .unwrap();
            assert_eq!(
                plan.native.iter().map(|(s, _)| *s).collect::<Vec<_>>(),
                [0, 2]
            );
            assert_eq!(sources(&plan.accelerators), [1]);
        }
    }
}
