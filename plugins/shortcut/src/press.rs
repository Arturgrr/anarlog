use std::sync::Mutex;

use tauri::{AppHandle, Manager, Runtime};
use tauri_specta::Event;

use crate::ShortcutEvent;

/// Several shortcuts can start the same dictation. The first one pressed owns
/// it until that shortcut is released, so pressing another one meanwhile does
/// nothing. `source` is the shortcut's position in the configured list.
#[derive(Default)]
pub struct Presses {
    owner: Mutex<Option<usize>>,
}

impl Presses {
    fn filter(&self, source: usize, event: ShortcutEvent) -> Option<ShortcutEvent> {
        let mut owner = self.owner.lock().unwrap_or_else(|e| e.into_inner());
        let pass = match event {
            ShortcutEvent::Pressed => owner.is_none(),
            ShortcutEvent::Released | ShortcutEvent::Discarded => *owner == Some(source),
            ShortcutEvent::Cancelled => true,
        };
        if pass {
            *owner = matches!(event, ShortcutEvent::Pressed).then_some(source);
        }
        pass.then_some(event)
    }

    pub fn reset(&self) {
        *self.owner.lock().unwrap_or_else(|e| e.into_inner()) = None;
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
}
