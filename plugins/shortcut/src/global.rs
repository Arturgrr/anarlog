use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, Shortcut, ShortcutState};
use tauri_specta::Event;

use crate::{
    AnnotateShortcutEvent, CaptureAction, CaptureShortcutEvent, CaptureShortcuts,
    PasteLastAnnotationEvent, PasteLastEvent, ShortcutEvent, ShortcutPluginExt, annotate, press,
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
const TAKEN_BY_CAPTURE: &str = "This shortcut is already used by Screenshots. Choose another one.";
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
    paste_last: Option<Shortcut>,
    annotate: Option<Shortcut>,
    annotate_paste: Option<Shortcut>,
    /// Capture's shortcuts, each held on its own; they give way to every
    /// other family's.
    capture: Vec<(CaptureAction, Shortcut)>,
    /// The Escape keys held, for dictation's cancel, Annotate's ink, or
    /// both: one handler serves both, so a key either still wants stays.
    escape: Vec<Shortcut>,
    /// Dictation records and takes Escape to cancel.
    cancel_wanted: bool,
    /// Annotate's ink is on and takes Escape to turn it off.
    annotate_escape_wanted: bool,
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
    Capture(CaptureAction),
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
            self.yield_annotate(backend, key)?;
            self.yield_capture(backend, key)?;
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
        self.remove_cancel(backend)?;
        release(&mut self.dictation, backend)
    }

    /// Annotate never keeps a key dictation or paste-last asks for: it lets
    /// it go, so dictation behaves as it would without Annotate.
    fn yield_annotate(&mut self, backend: &impl Backend, key: Shortcut) -> Result<(), String> {
        for slot in [&mut self.annotate, &mut self.annotate_paste] {
            if *slot == Some(key) {
                backend.unregister(key)?;
                *slot = None;
                tracing::warn!("an Annotate shortcut gave way to a dictation shortcut");
            }
        }
        Ok(())
    }

    /// Capture never keeps a key another Librelog shortcut asks for: it lets
    /// it go, so the others behave as they would without Capture.
    fn yield_capture(&mut self, backend: &impl Backend, key: Shortcut) -> Result<(), String> {
        if let Some(index) = self.capture.iter().position(|(_, held)| *held == key) {
            backend.unregister(key)?;
            let (action, _) = self.capture.remove(index);
            tracing::warn!(
                shortcut = action.name(),
                "a Capture shortcut gave way to another Librelog shortcut"
            );
        }
        Ok(())
    }

    /// Escape, alone and with each dictation shortcut's modifiers, which may
    /// still be held.
    fn add_cancel(&mut self, backend: &impl Backend) -> Result<(), String> {
        self.cancel_wanted = true;
        self.sync_escape(backend)
    }

    fn remove_cancel(&mut self, backend: &impl Backend) -> Result<(), String> {
        self.cancel_wanted = false;
        self.sync_escape(backend)
    }

    /// The Escape keys dictation and Annotate want now: alone, and with the
    /// modifiers of their shortcuts, which may still be held.
    fn wanted_escape(&self) -> Vec<Shortcut> {
        let mut mods = Vec::new();
        if self.cancel_wanted {
            mods.push(None);
            mods.extend(self.dictation.iter().map(|shortcut| Some(shortcut.mods)));
        }
        if self.annotate_escape_wanted {
            mods.push(None);
            mods.extend(self.annotate.map(|shortcut| Some(shortcut.mods)));
        }
        let mut keys: Vec<Shortcut> = Vec::new();
        for key in mods
            .into_iter()
            .map(|mods| Shortcut::new(mods, Code::Escape))
        {
            if !keys.contains(&key) {
                keys.push(key);
            }
        }
        keys
    }

    /// Holds exactly the Escape keys someone wants.
    fn sync_escape(&mut self, backend: &impl Backend) -> Result<(), String> {
        let wanted = self.wanted_escape();
        while let Some(index) = self.escape.iter().position(|key| !wanted.contains(key)) {
            backend.unregister(self.escape[index])?;
            self.escape.remove(index);
        }
        for key in wanted {
            if !self.escape.contains(&key) {
                backend.register(key, Action::Cancel)?;
                self.escape.push(key);
            }
        }
        Ok(())
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
        self.yield_annotate(backend, key)?;
        self.yield_capture(backend, key)?;
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
            self.yield_capture(backend, key)?;
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
    /// held while inking. Keys dictation also wants are shared.
    fn add_annotate_escape(&mut self, backend: &impl Backend) -> Result<(), String> {
        self.annotate_escape_wanted = true;
        self.sync_escape(backend)
    }

    fn remove_annotate_escape(&mut self, backend: &impl Backend) -> Result<(), String> {
        self.annotate_escape_wanted = false;
        self.sync_escape(backend)
    }
}

impl Keys {
    /// Replaces Capture's shortcuts. Each registers on its own: one that
    /// another Librelog shortcut holds, that an earlier one in `keys` took,
    /// that did not parse (`Err`), or that the system refused is left out,
    /// and the error names every one left out.
    fn set_capture(
        &mut self,
        backend: &impl Backend,
        keys: Vec<(CaptureAction, Result<Shortcut, String>)>,
    ) -> Result<(), String> {
        while let Some((_, key)) = self.capture.last().copied() {
            backend.unregister(key)?;
            self.capture.pop();
        }
        let mut failed = Vec::new();
        for (action, key) in keys {
            let registered = key.and_then(|key| {
                if self.dictation.contains(&key) {
                    return Err(TAKEN_BY_DICTATION.to_string());
                }
                if self.paste_last == Some(key) {
                    return Err(TAKEN_BY_PASTE_LAST.to_string());
                }
                if self.annotate == Some(key) || self.annotate_paste == Some(key) {
                    return Err(TAKEN_BY_ANNOTATE.to_string());
                }
                if self.capture.iter().any(|(_, held)| *held == key) {
                    return Err(TAKEN.to_string());
                }
                backend
                    .register(key, Action::Capture(action))
                    .map_err(|e| format!("It may be used by another app: {e}"))?;
                self.capture.push((action, key));
                Ok(())
            });
            if let Err(error) = registered {
                failed.push(format!(
                    "Could not register the {} shortcut. {error}",
                    action.name()
                ));
            }
        }
        if failed.is_empty() {
            Ok(())
        } else {
            Err(failed.join("\n"))
        }
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
            Action::Capture(action) => self.shortcuts.on_shortcut(key, move |app, _, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = CaptureShortcutEvent { action }.emit(app);
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
        registration.keys.remove_cancel(&global)
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
    // A release lost to re-registering would leave the key held forever.
    app.state::<annotate::AnnotateGesture>().release_key();
    let Some(global) = global(&app, &state) else {
        return if annotate.is_none() && paste.is_none() {
            Ok(())
        } else {
            Err(UNAVAILABLE.into())
        };
    };
    let mut result = registration.keys.set_annotate(&global, annotate, paste);
    if result.is_err() {
        let _ = registration.keys.set_annotate(&global, None, None);
    }
    // Ink's Escape follows the shortcut's modifiers.
    if let Err(error) = registration.keys.sync_escape(&global) {
        result = result.and(Err(error));
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
/// The Annotate plugin calls this as its session's ink changes.
pub async fn set_annotate_escape(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let Some(state) = app.try_state::<GlobalState>() else {
        return Ok(());
    };
    let mut registration = state.registration.lock().await;
    state.annotate_escape.store(enabled, Ordering::SeqCst);
    let Some(global) = global(app, &state) else {
        return Ok(());
    };
    if enabled {
        registration.keys.add_annotate_escape(&global)
    } else {
        registration.keys.remove_annotate_escape(&global)
    }
}

/// Registers Capture's shortcuts, replacing the previous ones; null or
/// empty leaves one unbound. Each needs a key with modifiers and none may be
/// another Librelog shortcut. Each registers on its own: when some cannot
/// be, the others still are, and the error names those that were not. Capture
/// always gives way: a dictation, paste-last or Annotate shortcut registered
/// later takes its key.
#[tauri::command]
#[specta::specta]
pub async fn configure_capture(
    app: tauri::AppHandle,
    shortcuts: CaptureShortcuts,
) -> Result<(), String> {
    let global_available = app.try_state::<GlobalShortcut>().is_some();
    let keys: Vec<_> = [
        (CaptureAction::Area, shortcuts.area),
        (CaptureAction::Fullscreen, shortcuts.fullscreen),
        (CaptureAction::Window, shortcuts.window),
        (CaptureAction::Record, shortcuts.record),
        (CaptureAction::Gif, shortcuts.gif),
    ]
    .into_iter()
    .filter_map(|(action, shortcut)| {
        let shortcut = shortcut.filter(|shortcut| !shortcut.trim().is_empty())?;
        Some((action, paste_last_key(&shortcut, global_available)))
    })
    .collect();
    let state = app.state::<GlobalState>();
    let mut registration = state.registration.lock().await;
    let Some(global) = global(&app, &state) else {
        return if keys.is_empty() {
            Ok(())
        } else {
            Err(UNAVAILABLE.into())
        };
    };
    registration.keys.set_capture(&global, keys)
}

/// Checks a Capture shortcut: a key with modifiers that none of `taken` (the
/// other Librelog shortcuts, the other Capture ones included) uses.
#[tauri::command]
#[specta::specta]
pub fn validate_capture(
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

#[cfg(target_os = "linux")]
mod portal;
#[cfg(any(target_os = "linux", test))]
mod trigger;

/// Checks a dictation shortcut, which must differ from the `paste_last`
/// shortcut when there is one, from Annotate's shortcuts (`annotate`, empty
/// while Annotate is off) and from Capture's (`capture`, empty while Capture
/// is off).
#[tauri::command]
#[specta::specta]
pub fn validate(
    app: tauri::AppHandle,
    shortcut: String,
    paste_last: Option<String>,
    annotate: Vec<String>,
    capture: Vec<String>,
) -> Result<(), String> {
    validate_dictation(
        &shortcut,
        paste_last.as_deref(),
        &annotate,
        &capture,
        app.try_state::<GlobalShortcut>().is_some(),
    )
}

/// Checks a paste-last shortcut: a key with modifiers that none of the
/// `dictation` shortcuts, Annotate's (`annotate`) or Capture's (`capture`)
/// uses.
#[tauri::command]
#[specta::specta]
pub fn validate_paste_last(
    app: tauri::AppHandle,
    shortcut: String,
    dictation: Vec<String>,
    annotate: Vec<String>,
    capture: Vec<String>,
) -> Result<(), String> {
    validate_paste_last_shortcut(
        &shortcut,
        &dictation,
        &annotate,
        &capture,
        app.try_state::<GlobalShortcut>().is_some(),
    )
}

fn uses(shortcuts: &[String], key: Shortcut) -> bool {
    shortcuts
        .iter()
        .any(|shortcut| parse_shortcut(shortcut).is_ok_and(|other| other == key))
}

fn validate_dictation(
    shortcut: &str,
    paste_last: Option<&str>,
    annotate: &[String],
    capture: &[String],
    global_available: bool,
) -> Result<(), String> {
    validate_shortcut(shortcut, global_available)?;
    let Ok(key) = parse_shortcut(shortcut) else {
        return Ok(());
    };
    if paste_last.map(parse_shortcut) == Some(Ok(key)) {
        return Err(TAKEN_BY_PASTE_LAST.into());
    }
    if uses(annotate, key) {
        return Err(TAKEN_BY_ANNOTATE.into());
    }
    if uses(capture, key) {
        return Err(TAKEN_BY_CAPTURE.into());
    }
    Ok(())
}

fn validate_paste_last_shortcut(
    shortcut: &str,
    dictation: &[String],
    annotate: &[String],
    capture: &[String],
    global_available: bool,
) -> Result<(), String> {
    let key = paste_last_key(shortcut, global_available)?;
    if uses(dictation, key) {
        return Err(TAKEN_BY_DICTATION.into());
    }
    if uses(annotate, key) {
        return Err(TAKEN_BY_ANNOTATE.into());
    }
    if uses(capture, key) {
        return Err(TAKEN_BY_CAPTURE.into());
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
        assert!(validate_paste_last_shortcut("Alt+Shift+KeyV", &dictation, &[], &[], true).is_ok());
        assert_eq!(
            validate_paste_last_shortcut("Alt+Control+KeyV", &dictation, &[], &[], true),
            Err(TAKEN_BY_DICTATION.into())
        );
        assert_eq!(
            validate_dictation("Shift+Alt+KeyV", Some("Alt+Shift+KeyV"), &[], &[], true),
            Err(TAKEN_BY_PASTE_LAST.into())
        );
        assert!(validate_dictation("Shift+Alt+KeyV", None, &[], &[], true).is_ok());
        for modifier_only in ["Fn", "RightCommand", "DoubleTap+AltLeft", "KeyV"] {
            assert_eq!(
                validate_paste_last_shortcut(modifier_only, &[], &[], &[], true),
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

    #[test]
    fn dictation_wins_a_conflict_with_annotate_in_either_order() {
        let key = |shortcut: &str| parse_shortcut(shortcut).unwrap();
        let os = Os::default();
        let mut keys = Keys::default();
        keys.set_annotate(
            &os,
            Some(key("Alt+Shift+KeyS")),
            Some(key("Alt+Shift+KeyA")),
        )
        .unwrap();
        // Saved before validation knew, or registered first at launch.
        keys.add_dictation(&os, vec![(0, key("Shift+Alt+KeyS"))])
            .unwrap();
        keys.set_paste_last(&os, Some(key("Shift+Alt+KeyA")))
            .unwrap();
        assert_eq!((keys.annotate, keys.annotate_paste), (None, None));
        assert_eq!(keys.dictation, [key("Alt+Shift+KeyS")]);
        // Annotate registering second loses as well.
        assert_eq!(
            keys.set_annotate(&os, Some(key("Alt+Shift+KeyS")), None),
            Err(TAKEN_BY_DICTATION.into())
        );
        assert_eq!(
            os.0.borrow().clone(),
            HashSet::from([key("Alt+Shift+KeyS"), key("Alt+Shift+KeyA")])
        );
        assert_eq!(
            validate_dictation(
                "Alt+Shift+KeyX",
                None,
                &["Shift+Alt+KeyX".into()],
                &[],
                true
            ),
            Err(TAKEN_BY_ANNOTATE.into())
        );
        assert_eq!(
            validate_paste_last_shortcut(
                "Alt+Shift+KeyX",
                &[],
                &["Shift+Alt+KeyX".into()],
                &[],
                true
            ),
            Err(TAKEN_BY_ANNOTATE.into())
        );
    }

    #[test]
    fn escape_stays_while_either_dictation_or_annotate_wants_it() {
        let key = |shortcut: &str| parse_shortcut(shortcut).unwrap();
        let escape = Shortcut::new(None, Code::Escape);
        let os = Os::default();
        let mut keys = Keys::default();
        keys.add_dictation(&os, vec![(0, key("Control+Alt+Space"))])
            .unwrap();
        keys.set_annotate(&os, Some(key("Alt+Shift+KeyS")), None)
            .unwrap();

        // Ink ends while dictation records: dictation keeps its Escape.
        keys.add_cancel(&os).unwrap();
        keys.add_annotate_escape(&os).unwrap();
        keys.remove_annotate_escape(&os).unwrap();
        assert!(os.0.borrow().contains(&escape));
        keys.remove_cancel(&os).unwrap();
        assert!(!os.0.borrow().contains(&escape));

        // Dictation ends while ink is on: ink keeps it.
        keys.add_annotate_escape(&os).unwrap();
        keys.add_cancel(&os).unwrap();
        keys.remove_dictation(&os).unwrap();
        assert!(os.0.borrow().contains(&escape));
        keys.remove_annotate_escape(&os).unwrap();
        assert_eq!(
            os.0.borrow().clone(),
            HashSet::from([key("Alt+Shift+KeyS")])
        );
    }

    #[test]
    fn capture_gives_way_to_every_other_shortcut_and_registers_the_rest_on_its_own() {
        let key = |shortcut: &str| parse_shortcut(shortcut).unwrap();
        let os = Os::default();
        let mut keys = Keys::default();
        keys.add_dictation(&os, vec![(0, key("Control+Alt+Space"))])
            .unwrap();
        keys.set_paste_last(&os, Some(key("Alt+Shift+KeyV")))
            .unwrap();
        keys.set_annotate(&os, Some(key("Alt+Shift+KeyS")), None)
            .unwrap();
        // Another app holds this one.
        os.0.borrow_mut().insert(key("Alt+Shift+Digit6"));

        let error = keys
            .set_capture(
                &os,
                vec![
                    (CaptureAction::Area, Ok(key("Alt+Shift+Digit4"))),
                    (CaptureAction::Fullscreen, Ok(key("Shift+Alt+KeyV"))),
                    (CaptureAction::Window, Err(NEEDS_MODIFIER.into())),
                    (CaptureAction::Record, Ok(key("Alt+Shift+Digit5"))),
                    (CaptureAction::Gif, Ok(key("Alt+Shift+Digit6"))),
                ],
            )
            .unwrap_err();
        assert_eq!(
            keys.capture,
            [
                (CaptureAction::Area, key("Alt+Shift+Digit4")),
                (CaptureAction::Record, key("Alt+Shift+Digit5")),
            ]
        );
        for failed in ["capture full screen", "capture window", "record GIF"] {
            assert!(error.contains(failed), "{error}");
        }
        assert!(!error.contains("capture area") && error.contains(TAKEN_BY_PASTE_LAST));

        // Dictation and Annotate registered later take Capture's keys.
        keys.add_dictation(&os, vec![(1, key("Shift+Alt+Digit4"))])
            .unwrap();
        keys.set_annotate(
            &os,
            Some(key("Alt+Shift+KeyS")),
            Some(key("Shift+Alt+Digit5")),
        )
        .unwrap();
        assert!(keys.capture.is_empty());
        assert_eq!(keys.annotate_paste, Some(key("Alt+Shift+Digit5")));
        assert!(os.0.borrow().contains(&key("Alt+Shift+Digit4")));

        let capture = ["Shift+Alt+Digit3".to_string()];
        assert_eq!(
            validate_dictation("Alt+Shift+Digit3", None, &[], &capture, true),
            Err(TAKEN_BY_CAPTURE.into())
        );
        assert_eq!(
            validate_paste_last_shortcut("Alt+Shift+Digit3", &[], &[], &capture, true),
            Err(TAKEN_BY_CAPTURE.into())
        );
    }
}
