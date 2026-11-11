use std::sync::Mutex;

use tauri::{AppHandle, Manager, Runtime};
use tauri_specta::Event;

use crate::ShortcutEvent;

/// Several shortcuts can start the same dictation. The first one pressed owns
/// it until that shortcut is released, so pressing another one meanwhile does
/// nothing. `source` is the shortcut's position in the configured list.
#[derive(Default)]
pub struct Presses(Mutex<State>);

#[derive(Default)]
struct State {
    /// The shortcut holding the dictation, and which press that was.
    owner: Option<(usize, u64)>,
    presses: u64,
    /// The press that held the shortcut when a capture became active.
    active: Option<u64>,
}

impl Presses {
    fn filter(&self, source: usize, event: ShortcutEvent) -> Option<ShortcutEvent> {
        let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let pass = match event {
            ShortcutEvent::Pressed => state.owner.is_none(),
            ShortcutEvent::Released | ShortcutEvent::Discarded => {
                state.owner.is_some_and(|(owner, _)| owner == source)
            }
            ShortcutEvent::Cancelled => true,
        };
        if pass {
            state.owner = if matches!(event, ShortcutEvent::Pressed) {
                state.presses += 1;
                Some((source, state.presses))
            } else {
                None
            };
        }
        pass.then_some(event)
    }

    pub fn reset(&self) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).owner = None;
    }

    /// A capture began, held by the current press if any.
    pub fn activate(&self) {
        let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
        state.active = state.owner.map(|(_, press)| press);
    }

    /// A capture ended. Forgets the press that held it, whose release may
    /// never come, but not a newer press: when a shortcut is released and
    /// pressed again before this arrives, that press starts the next capture
    /// and its release must still stop it.
    pub fn deactivate(&self) {
        let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if state.owner.map(|(_, press)| press) == state.active.take() {
            state.owner = None;
        }
    }
}

pub fn emit<R: Runtime>(app: &AppHandle<R>, source: usize, event: ShortcutEvent) {
    if let Some(event) = app.state::<Presses>().filter(source, event) {
        let _ = event.emit(app);
    }
}

pub fn cancel<R: Runtime>(app: &AppHandle<R>) {
    app.state::<Presses>().reset();
    let _ = ShortcutEvent::Cancelled.emit(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_shortcut_pressed_owns_the_dictation_until_it_is_released() {
        let presses = Presses::default();
        let pass = |source, event| presses.filter(source, event).is_some();

        assert!(pass(0, ShortcutEvent::Pressed));
        assert!(!pass(1, ShortcutEvent::Pressed));
        assert!(!pass(1, ShortcutEvent::Released));
        assert!(!pass(0, ShortcutEvent::Pressed));
        assert!(pass(0, ShortcutEvent::Released));
        assert!(!pass(0, ShortcutEvent::Released));

        assert!(pass(1, ShortcutEvent::Pressed));
        assert!(!pass(0, ShortcutEvent::Discarded));
        assert!(pass(0, ShortcutEvent::Cancelled));
        assert!(pass(0, ShortcutEvent::Pressed));
    }

    #[test]
    fn a_quick_second_press_still_stops_its_capture_when_the_first_ends_late() {
        let presses = Presses::default();
        let pass = |source, event| presses.filter(source, event).is_some();

        assert!(pass(0, ShortcutEvent::Pressed));
        presses.activate();
        assert!(pass(0, ShortcutEvent::Released));
        assert!(pass(0, ShortcutEvent::Pressed));
        presses.deactivate();
        assert!(pass(0, ShortcutEvent::Released));

        // A release that never came no longer blocks the next dictation.
        assert!(pass(0, ShortcutEvent::Pressed));
        presses.activate();
        presses.deactivate();
        assert!(pass(1, ShortcutEvent::Pressed));
    }
}
