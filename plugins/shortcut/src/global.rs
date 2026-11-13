use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, Shortcut, ShortcutState};
use tauri_specta::Event;

use crate::{
    AnnotateShortcutEvent, PasteLastAnnotationEvent, PasteLastEvent, ShortcutEvent,
    ShortcutPluginExt, annotate, press,
};

pub fn uses_portal() -> bool {
    cfg!(target_os = "linux") && std::env::var_os("WAYLAND_DISPLAY").is_some()
}

const UNAVAILABLE: &str = "Global shortcuts are unavailable in this desktop session.";
const NEEDS_MODIFIER: &str = "Choose a shortcut with Control, Alt, Shift, or Command.";
const TAKEN_BY_DICTATION: &str = "This shortcut already starts dictation. Choose another one.";
const TAKEN_BY_PASTE_LAST: &str =
    "This shortcut already pastes the last dictation. Choose another one.";
const TAKEN_BY_ANNOTATE: &str = "This shortcut is already used by Annotate. Choose another one.";
const TAKEN: &str =
    "This shortcut is already used by another Librelog shortcut. Choose another one.";

#[derive(Default)]
pub struct GlobalState {
    registration: tokio::sync::Mutex<Registration>,
    active: Arc<AtomicBool>,
    /// Escape turns Annotate's ink off while this is set.
    annotate_escape: Arc<AtomicBool>,
}

#[derive(Default)]
struct Registration {
    keys: Keys,
    #[cfg(target_os = "linux")]
    portal: Option<portal::Registration>,
    #[cfg(target_os = "linux")]
    paste_last_portal: Option<portal::Registration>,
}

/// The accelerators held through tauri-plugin-global-shortcut, kept by what
/// they do so that reconfiguring dictation never drops the paste-last
/// shortcut, and the other way round.
#[derive(Default)]
struct Keys {
    dictation: Vec<Shortcut>,
    cancel: Vec<Shortcut>,
    paste_last: Option<Shortcut>,
    annotate: Option<Shortcut>,
    annotate_paste: Option<Shortcut>,
    /// Escape keys held for Annotate that dictation's `cancel` does not hold.
    annotate_escape: Vec<Shortcut>,
}

#[derive(Clone, Copy)]
enum Action {
    /// Starts and stops dictation; the shortcut's position in the configured
    /// list.
    Dictate(usize),
    Cancel,
    PasteLast,
    /// Annotate's start, stop and hold-to-ink key.
    Annotate,
    PasteLastAnnotation,
}

trait Backend {
    fn register(&self, key: Shortcut, action: Action) -> Result<(), String>;
    fn unregister(&self, key: Shortcut) -> Result<(), String>;
}

impl Keys {
    fn add_dictation(
        &mut self,
        backend: &impl Backend,
        keys: Vec<(usize, Shortcut)>,
    ) -> Result<(), String> {
        for (source, key) in keys {
            if self.paste_last == Some(key) {
                return Err(TAKEN_BY_PASTE_LAST.into());
            }
            if self.annotate == Some(key) || self.annotate_paste == Some(key) {
                return Err(TAKEN_BY_ANNOTATE.into());
            }
            backend
                .register(key, Action::Dictate(source))
                .map_err(|e| {
                    format!(
                        "Could not register dictation shortcut. It may be used by another app: {e}"
                    )
                })?;
            self.dictation.push(key);
        }
        Ok(())
    }

    fn remove_dictation(&mut self, backend: &impl Backend) -> Result<(), String> {
        release(&mut self.cancel, backend)?;
        release(&mut self.dictation, backend)
    }

    /// Escape, alone and with each dictation shortcut's modifiers, which may
    /// still be held.
    fn add_cancel(&mut self, backend: &impl Backend) -> Result<(), String> {
        let keys = std::iter::once(Shortcut::new(None, Code::Escape))
            .chain(
                self.dictation
                    .iter()
                    .map(|shortcut| Shortcut::new(Some(shortcut.mods), Code::Escape)),
            )
            .collect::<Vec<_>>();
        for key in keys {
            if self.cancel.contains(&key) || self.annotate_escape.contains(&key) {
                continue;
            }
            backend.register(key, Action::Cancel)?;
            self.cancel.push(key);
        }
        Ok(())
    }

    fn remove_cancel(&mut self, backend: &impl Backend) -> Result<(), String> {
        release(&mut self.cancel, backend)
    }

    /// Replaces the paste-last shortcut with `key`, or only removes it.
    fn set_paste_last(
        &mut self,
        backend: &impl Backend,
        key: Option<Shortcut>,
    ) -> Result<(), String> {
        if let Some(current) = self.paste_last {
            backend.unregister(current)?;
            self.paste_last = None;
        }
        let Some(key) = key else {
            return Ok(());
        };
        if self.dictation.contains(&key) {
            return Err(TAKEN_BY_DICTATION.into());
        }
        if self.annotate == Some(key) || self.annotate_paste == Some(key) {
            return Err(TAKEN_BY_ANNOTATE.into());
        }
        backend.register(key, Action::PasteLast).map_err(|e| {
            format!(
                "Could not register the paste last dictation shortcut. It may be used by another app: {e}"
            )
        })?;
        self.paste_last = Some(key);
        Ok(())
    }
}

impl Keys {
    /// Replaces Annotate's two shortcuts; `None` leaves one out. Neither may
    /// be a dictation shortcut, the paste-last one or the other.
    fn set_annotate(
        &mut self,
        backend: &impl Backend,
        annotate: Option<Shortcut>,
        paste: Option<Shortcut>,
    ) -> Result<(), String> {
        for current in [self.annotate.take(), self.annotate_paste.take()]
            .into_iter()
            .flatten()
        {
            backend.unregister(current)?;
        }
        if annotate.is_some() && annotate == paste {
            return Err(TAKEN.into());
        }
        for (key, action) in [
            (annotate, Action::Annotate),
            (paste, Action::PasteLastAnnotation),
        ] {
            let Some(key) = key else { continue };
            if self.dictation.contains(&key) {
                return Err(TAKEN_BY_DICTATION.into());
            }
            if self.paste_last == Some(key) {
                return Err(TAKEN_BY_PASTE_LAST.into());
            }
            backend.register(key, action).map_err(|e| {
                format!(
                    "Could not register the Annotate shortcut. It may be used by another app: {e}"
                )
            })?;
            match action {
                Action::Annotate => self.annotate = Some(key),
                _ => self.annotate_paste = Some(key),
            }
        }
        Ok(())
    }

    /// Escape, alone and with the Annotate shortcut's modifiers, which may be
    /// held while inking. Keys dictation already holds are shared.
    fn add_annotate_escape(&mut self, backend: &impl Backend) -> Result<(), String> {
        let keys = std::iter::once(Shortcut::new(None, Code::Escape))
            .chain(
                self.annotate
                    .map(|shortcut| Shortcut::new(Some(shortcut.mods), Code::Escape)),
            )
            .collect::<Vec<_>>();
        for key in keys {
            if self.cancel.contains(&key) || self.annotate_escape.contains(&key) {
                continue;
            }
            backend.register(key, Action::Cancel)?;
            self.annotate_escape.push(key);
        }
        Ok(())
    }

    fn remove_annotate_escape(&mut self, backend: &impl Backend) -> Result<(), String> {
        release(&mut self.annotate_escape, backend)
    }
}

fn release(keys: &mut Vec<Shortcut>, backend: &impl Backend) -> Result<(), String> {
    while let Some(key) = keys.last().copied() {
        backend.unregister(key)?;
        keys.pop();
    }
    Ok(())
}

struct Global<'a> {
    shortcuts: &'a GlobalShortcut,
    active: &'a Arc<AtomicBool>,
    annotate_escape: &'a Arc<AtomicBool>,
}

impl Backend for Global<'_> {
    fn register(&self, key: Shortcut, action: Action) -> Result<(), String> {
        let registered = match action {
            Action::Dictate(source) => self.shortcuts.on_shortcut(key, move |app, _, event| {
                let event = if event.state == ShortcutState::Pressed {
                    ShortcutEvent::Pressed
                } else {
                    ShortcutEvent::Released
                };
                press::emit(app, source, event);
            }),
            Action::Cancel => {
                let enabled = self.active.clone();
                let annotate = self.annotate_escape.clone();
                self.shortcuts.on_shortcut(key, move |app, _, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    if enabled.load(Ordering::SeqCst) {
                        press::cancel(app);
                    }
                    if annotate.load(Ordering::SeqCst) {
                        let _ = AnnotateShortcutEvent::Escape.emit(app);
                    }
                })
            }
            Action::Annotate => self.shortcuts.on_shortcut(key, |app, _, event| {
                if event.state == ShortcutState::Pressed {
                    annotate::pressed(app);
                } else {
                    annotate::released(app);
                }
            }),
            Action::PasteLastAnnotation => self.shortcuts.on_shortcut(key, |app, _, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = PasteLastAnnotationEvent {}.emit(app);
                }
            }),
            Action::PasteLast => self.shortcuts.on_shortcut(key, |app, _, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = PasteLastEvent {}.emit(app);
                }
            }),
        };
        registered.map_err(|e| e.to_string())
    }

    fn unregister(&self, key: Shortcut) -> Result<(), String> {
        self.shortcuts.unregister(key).map_err(|e| e.to_string())
    }
}

/// None where tauri-plugin-global-shortcut isn't running: on Wayland, or when
/// it failed to start.
fn global<'a>(app: &'a tauri::AppHandle, state: &'a GlobalState) -> Option<Global<'a>> {
    app.try_state::<GlobalShortcut>().map(|shortcuts| Global {
        shortcuts: shortcuts.inner(),
        active: &state.active,
        annotate_escape: &state.annotate_escape,
    })
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
    unregister(&app, &state, &mut registration).await?;

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
        let global = global(&app, &state).ok_or(UNAVAILABLE)?;
        registration.keys.add_dictation(&global, plan.accelerators)
    }
    .await;
    if result.is_err() {
        let _ = unregister(&app, &state, &mut registration).await;
    }
    result
}

/// Releases the dictation shortcuts; the paste-last one stays.
async fn unregister(
    app: &tauri::AppHandle,
    state: &GlobalState,
    registration: &mut Registration,
) -> Result<(), String> {
    app.shortcut().unregister().map_err(|e| e.to_string())?;
    if let Some(global) = global(app, state) {
        registration.keys.remove_dictation(&global)?;
    }
    #[cfg(target_os = "linux")]
    if let Some(portal) = registration.portal.take() {
        portal.close().await;
    }
    Ok(())
}

/// Registers `shortcut`, a key with modifiers, to paste the last dictation
/// again, replacing the previous one; `None` unregisters it. The dictation
/// shortcuts are left as they are. Fires on key press only.
#[tauri::command]
#[specta::specta]
pub async fn configure_paste_last(
    app: tauri::AppHandle,
    shortcut: Option<String>,
) -> Result<(), String> {
    let global_available = app.try_state::<GlobalShortcut>().is_some();
    let key = shortcut
        .map(|shortcut| paste_last_key(&shortcut, global_available))
        .transpose()?;
    let state = app.state::<GlobalState>();
    let mut registration = state.registration.lock().await;
    #[cfg(target_os = "linux")]
    if let Some(portal) = registration.paste_last_portal.take() {
        portal.close().await;
    }
    #[cfg(target_os = "linux")]
    if uses_portal() {
        if let Some(key) = key {
            registration.paste_last_portal =
                Some(portal::register_paste_last(app.clone(), key).await?);
        }
        return Ok(());
    }
    match global(&app, &state) {
        Some(global) => registration.keys.set_paste_last(&global, key),
        None if key.is_some() => Err(UNAVAILABLE.into()),
        None => Ok(()),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn set_active(app: tauri::AppHandle, active: bool) -> Result<(), String> {
    let state = app.state::<GlobalState>();
    let mut registration = state.registration.lock().await;
    state.active.store(active, Ordering::SeqCst);
    let presses = app.state::<press::Presses>();
    if active {
        presses.activate();
    } else {
        presses.deactivate();
    }
    #[cfg(target_os = "linux")]
    if uses_portal() {
        return Ok(());
    }
    let Some(global) = global(&app, &state) else {
        return Ok(());
    };
    if active {
        registration.keys.add_cancel(&global)
    } else {
        registration.keys.remove_cancel(&global)?;
        // Annotate may still need the Escape dictation held.
        if state.annotate_escape.load(Ordering::SeqCst) {
            registration.keys.add_annotate_escape(&global)?;
        }
        Ok(())
    }
}

/// Registers Annotate's shortcut, which starts, stops and inks, and its
/// paste-last-annotation shortcut, replacing the previous ones; `None`
/// leaves one out. Each needs a key with modifiers. If one cannot be
/// registered, neither stays registered.
#[tauri::command]
#[specta::specta]
pub async fn configure_annotate(
    app: tauri::AppHandle,
    shortcut: Option<String>,
    paste: Option<String>,
) -> Result<(), String> {
    let global_available = app.try_state::<GlobalShortcut>().is_some();
    let key = |shortcut: Option<String>| {
        shortcut
            .map(|shortcut| paste_last_key(&shortcut, global_available))
            .transpose()
    };
    let (annotate, paste) = (key(shortcut)?, key(paste)?);
    let state = app.state::<GlobalState>();
    let mut registration = state.registration.lock().await;
    let Some(global) = global(&app, &state) else {
        return if annotate.is_none() && paste.is_none() {
            Ok(())
        } else {
            Err(UNAVAILABLE.into())
        };
    };
    let result = registration.keys.set_annotate(&global, annotate, paste);
    if result.is_err() {
        let _ = registration.keys.set_annotate(&global, None, None);
    }
    result
}

/// Checks an Annotate shortcut: a key with modifiers that none of `taken`
/// (the other Librelog shortcuts) uses.
#[tauri::command]
#[specta::specta]
pub fn validate_annotate(
    app: tauri::AppHandle,
    shortcut: String,
    taken: Vec<String>,
) -> Result<(), String> {
    validate_annotate_shortcut(
        &shortcut,
        &taken,
        app.try_state::<GlobalShortcut>().is_some(),
    )
}

fn validate_annotate_shortcut(
    shortcut: &str,
    taken: &[String],
    global_available: bool,
) -> Result<(), String> {
    let key = paste_last_key(shortcut, global_available)?;
    if taken
        .iter()
        .any(|other| parse_shortcut(other).is_ok_and(|other| other == key))
    {
        return Err(TAKEN.into());
    }
    Ok(())
}

/// Tells the Annotate shortcut whether a recording runs, so its next press
/// starts one or stops or inks this one.
#[tauri::command]
#[specta::specta]
pub async fn set_annotate_recording(app: tauri::AppHandle, recording: bool) -> Result<(), String> {
    app.state::<annotate::AnnotateGesture>()
        .set_recording(recording);
    Ok(())
}

/// Takes Escape from other apps while Annotate's ink is on, to turn it off.
#[tauri::command]
#[specta::specta]
pub async fn set_annotate_escape(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let state = app.state::<GlobalState>();
    let mut registration = state.registration.lock().await;
    state.annotate_escape.store(enabled, Ordering::SeqCst);
    let Some(global) = global(&app, &state) else {
        return Ok(());
    };
    if enabled {
        registration.keys.add_annotate_escape(&global)
    } else {
        registration.keys.remove_annotate_escape(&global)
    }
}

#[cfg(target_os = "linux")]
mod portal;
#[cfg(any(target_os = "linux", test))]
mod trigger;

/// Checks a dictation shortcut, which must differ from the `paste_last`
/// shortcut when there is one.
#[tauri::command]
#[specta::specta]
pub fn validate(
    app: tauri::AppHandle,
    shortcut: String,
    paste_last: Option<String>,
) -> Result<(), String> {
    validate_dictation(
        &shortcut,
        paste_last.as_deref(),
        app.try_state::<GlobalShortcut>().is_some(),
    )
}

/// Checks a paste-last shortcut: a key with modifiers that none of the
/// `dictation` shortcuts uses.
#[tauri::command]
#[specta::specta]
pub fn validate_paste_last(
    app: tauri::AppHandle,
    shortcut: String,
    dictation: Vec<String>,
) -> Result<(), String> {
    validate_paste_last_shortcut(
        &shortcut,
        &dictation,
        app.try_state::<GlobalShortcut>().is_some(),
    )
}

fn validate_dictation(
    shortcut: &str,
    paste_last: Option<&str>,
    global_available: bool,
) -> Result<(), String> {
    validate_shortcut(shortcut, global_available)?;
    if let (Ok(key), Some(Ok(paste_last))) =
        (parse_shortcut(shortcut), paste_last.map(parse_shortcut))
        && key == paste_last
    {
        return Err(TAKEN_BY_PASTE_LAST.into());
    }
    Ok(())
}

fn validate_paste_last_shortcut(
    shortcut: &str,
    dictation: &[String],
    global_available: bool,
) -> Result<(), String> {
    let key = paste_last_key(shortcut, global_available)?;
    if dictation
        .iter()
        .any(|shortcut| parse_shortcut(shortcut).is_ok_and(|other| other == key))
    {
        return Err(TAKEN_BY_DICTATION.into());
    }
    Ok(())
}

/// Paste-last needs a key with modifiers: modifier-only and double-tap
/// triggers are for dictation.
fn paste_last_key(shortcut: &str, global_available: bool) -> Result<Shortcut, String> {
    if is_native(shortcut) {
        return Err(NEEDS_MODIFIER.into());
    }
    validate_shortcut(shortcut, global_available)?;
    parse_shortcut(shortcut)
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
        return Err(UNAVAILABLE.into());
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
        return Err(NEEDS_MODIFIER.into());
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
    fn rejects_a_paste_last_shortcut_that_dictation_uses_and_the_other_way_round() {
        let dictation = ["DoubleTap+AltLeft".to_string(), "Control+Alt+KeyV".into()];
        assert!(validate_paste_last_shortcut("Alt+Shift+KeyV", &dictation, true).is_ok());
        assert_eq!(
            validate_paste_last_shortcut("Alt+Control+KeyV", &dictation, true),
            Err(TAKEN_BY_DICTATION.into())
        );
        assert_eq!(
            validate_dictation("Shift+Alt+KeyV", Some("Alt+Shift+KeyV"), true),
            Err(TAKEN_BY_PASTE_LAST.into())
        );
        assert!(validate_dictation("Shift+Alt+KeyV", None, true).is_ok());
        for modifier_only in ["Fn", "RightCommand", "DoubleTap+AltLeft", "KeyV"] {
            assert_eq!(
                validate_paste_last_shortcut(modifier_only, &[], true),
                Err(NEEDS_MODIFIER.into())
            );
        }
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

#[cfg(test)]
mod registration_tests {
    use std::{cell::RefCell, collections::HashSet};

    use super::*;

    /// Holds each accelerator once, as the OS does.
    #[derive(Default)]
    struct Os(RefCell<HashSet<Shortcut>>);

    impl Backend for Os {
        fn register(&self, key: Shortcut, _: Action) -> Result<(), String> {
            if self.0.borrow_mut().insert(key) {
                Ok(())
            } else {
                Err("already registered".into())
            }
        }

        fn unregister(&self, key: Shortcut) -> Result<(), String> {
            if self.0.borrow_mut().remove(&key) {
                Ok(())
            } else {
                Err("not registered".into())
            }
        }
    }

    #[test]
    fn reconfiguring_dictation_or_paste_last_never_drops_the_other() {
        let key = |shortcut: &str| parse_shortcut(shortcut).unwrap();
        let os = Os::default();
        let held = || os.0.borrow().clone();
        let mut keys = Keys::default();

        keys.add_dictation(&os, vec![(0, key("Control+Alt+Space"))])
            .unwrap();
        keys.set_paste_last(&os, Some(key("Alt+Shift+KeyV")))
            .unwrap();
        keys.add_cancel(&os).unwrap();
        keys.remove_dictation(&os).unwrap();
        assert_eq!(held(), HashSet::from([key("Alt+Shift+KeyV")]));

        keys.add_dictation(&os, vec![(0, key("Control+Alt+KeyD"))])
            .unwrap();
        keys.set_paste_last(&os, Some(key("Control+Shift+KeyV")))
            .unwrap();
        assert_eq!(
            held(),
            HashSet::from([key("Control+Alt+KeyD"), key("Control+Shift+KeyV")])
        );
        keys.set_paste_last(&os, None).unwrap();
        assert_eq!(held(), HashSet::from([key("Control+Alt+KeyD")]));

        assert_eq!(
            keys.set_paste_last(&os, Some(key("Alt+Control+KeyD"))),
            Err(TAKEN_BY_DICTATION.into())
        );
        keys.set_paste_last(&os, Some(key("Alt+Shift+KeyV")))
            .unwrap();
        assert_eq!(
            keys.add_dictation(&os, vec![(1, key("Shift+Alt+KeyV"))]),
            Err(TAKEN_BY_PASTE_LAST.into())
        );
        assert_eq!(
            held(),
            HashSet::from([key("Control+Alt+KeyD"), key("Alt+Shift+KeyV")])
        );
    }

    #[test]
    fn annotate_shortcuts_never_take_dictations_and_share_its_escape() {
        let key = |shortcut: &str| parse_shortcut(shortcut).unwrap();
        let os = Os::default();
        let held = || os.0.borrow().clone();
        let mut keys = Keys::default();
        keys.add_dictation(&os, vec![(0, key("Control+Alt+Space"))])
            .unwrap();
        keys.set_paste_last(&os, Some(key("Alt+Shift+KeyV")))
            .unwrap();
        // The defaults fit beside dictation's.
        keys.set_annotate(
            &os,
            Some(key("Alt+Shift+KeyS")),
            Some(key("Alt+Shift+KeyA")),
        )
        .unwrap();
        assert_eq!(
            keys.set_annotate(&os, Some(key("Alt+Shift+KeyV")), None),
            Err(TAKEN_BY_PASTE_LAST.into())
        );
        keys.set_annotate(
            &os,
            Some(key("Alt+Shift+KeyS")),
            Some(key("Alt+Shift+KeyA")),
        )
        .unwrap();
        assert_eq!(
            keys.set_paste_last(&os, Some(key("Shift+Alt+KeyA"))),
            Err(TAKEN_BY_ANNOTATE.into())
        );
        keys.set_paste_last(&os, Some(key("Alt+Shift+KeyV")))
            .unwrap();

        // Dictation and Annotate both want Escape; each key is held once,
        // and Annotate keeps its own when dictation lets go.
        keys.add_cancel(&os).unwrap();
        keys.add_annotate_escape(&os).unwrap();
        let held_escape = Shortcut::new(Some(key("Alt+Shift+KeyS").mods), Code::Escape);
        assert!(held().contains(&held_escape));
        keys.remove_cancel(&os).unwrap();
        keys.add_annotate_escape(&os).unwrap();
        assert!(held().contains(&Shortcut::new(None, Code::Escape)));
        keys.remove_annotate_escape(&os).unwrap();
        assert_eq!(
            held(),
            HashSet::from([
                key("Control+Alt+Space"),
                key("Alt+Shift+KeyV"),
                key("Alt+Shift+KeyS"),
                key("Alt+Shift+KeyA"),
            ])
        );
        assert_eq!(
            validate_annotate_shortcut("Alt+Shift+KeyS", &["Alt+Shift+KeyA".into()], true),
            Ok(())
        );
        assert_eq!(
            validate_annotate_shortcut("Shift+Alt+KeyA", &["Alt+Shift+KeyA".into()], true),
            Err(TAKEN.into())
        );
    }
}
