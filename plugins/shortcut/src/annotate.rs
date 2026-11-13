//! The Annotate shortcut's taps and holds. Idle, a press starts a recording.
//! Recording, a tap stops it, while a hold of `HOLD` or more inks until the
//! key is released and leaves the recording running. A press within
//! `DEBOUNCE` of the start is ignored, so a start's key bounce never stops
//! what it started.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::Manager;
use tauri_specta::Event;

use crate::AnnotateShortcutEvent;

pub const HOLD: Duration = Duration::from_millis(250);
pub const DEBOUNCE: Duration = Duration::from_millis(400);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Start,
    Stop,
    InkOn,
    InkOff,
}

/// What a press asks for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pressed {
    Nothing,
    Act(Action),
    /// Call [`Gesture::held`] with this press after [`HOLD`].
    WaitForHold(u64),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Key {
    Up,
    /// Down, and its release means nothing.
    Ignored,
    Down {
        at: Instant,
        id: u64,
        inking: bool,
    },
}

#[derive(Debug)]
pub struct Gesture {
    /// When the recording started (or was asked to), while one runs.
    recording: Option<Instant>,
    key: Key,
    presses: u64,
}

impl Default for Gesture {
    fn default() -> Self {
        Self {
            recording: None,
            key: Key::Up,
            presses: 0,
        }
    }
}

impl Gesture {
    pub fn press(&mut self, now: Instant) -> Pressed {
        // Key repeat.
        if self.key != Key::Up {
            return Pressed::Nothing;
        }
        match self.recording {
            None => {
                self.key = Key::Ignored;
                self.recording = Some(now);
                Pressed::Act(Action::Start)
            }
            Some(since) if now.saturating_duration_since(since) < DEBOUNCE => {
                self.key = Key::Ignored;
                Pressed::Nothing
            }
            Some(_) => {
                self.presses += 1;
                self.key = Key::Down {
                    at: now,
                    id: self.presses,
                    inking: false,
                };
                Pressed::WaitForHold(self.presses)
            }
        }
    }

    /// `HOLD` after press `id`: still down, it inks.
    pub fn held(&mut self, id: u64) -> Option<Action> {
        let recording = self.recording.is_some();
        if let Key::Down {
            id: down, inking, ..
        } = &mut self.key
            && *down == id
            && !*inking
            && recording
        {
            *inking = true;
            return Some(Action::InkOn);
        }
        None
    }

    pub fn release(&mut self, now: Instant) -> Option<Action> {
        let key = std::mem::replace(&mut self.key, Key::Up);
        match key {
            Key::Down { inking: true, .. } => Some(Action::InkOff),
            Key::Down { at, .. }
                if self.recording.is_some() && now.saturating_duration_since(at) < HOLD =>
            {
                self.recording = None;
                Some(Action::Stop)
            }
            _ => None,
        }
    }

    /// The host says whether a recording runs: it started (`true`) or
    /// failed to, stopped or was discarded (`false`).
    pub fn set_recording(&mut self, recording: bool, now: Instant) {
        match (recording, self.recording) {
            (true, None) => self.recording = Some(now),
            (false, _) => self.recording = None,
            _ => {}
        }
    }
}

#[derive(Default)]
pub struct AnnotateGesture(Mutex<Gesture>);

impl AnnotateGesture {
    fn with<T>(&self, f: impl FnOnce(&mut Gesture) -> T) -> T {
        f(&mut self.0.lock().unwrap_or_else(|e| e.into_inner()))
    }

    pub fn set_recording(&self, recording: bool) {
        self.with(|gesture| gesture.set_recording(recording, Instant::now()));
    }
}

fn emit<R: tauri::Runtime>(app: &tauri::AppHandle<R>, action: Action) {
    let event = match action {
        Action::Start => AnnotateShortcutEvent::Start,
        Action::Stop => AnnotateShortcutEvent::Stop,
        Action::InkOn => AnnotateShortcutEvent::InkOn,
        Action::InkOff => AnnotateShortcutEvent::InkOff,
    };
    let _ = event.emit(app);
}

pub fn pressed<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let pressed = app
        .state::<AnnotateGesture>()
        .with(|gesture| gesture.press(Instant::now()));
    match pressed {
        Pressed::Nothing => {}
        Pressed::Act(action) => emit(app, action),
        Pressed::WaitForHold(id) => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(HOLD).await;
                if let Some(action) = app.state::<AnnotateGesture>().with(|g| g.held(id)) {
                    emit(&app, action);
                }
            });
        }
    }
}

pub fn released<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let action = app
        .state::<AnnotateGesture>()
        .with(|gesture| gesture.release(Instant::now()));
    if let Some(action) = action {
        emit(app, action);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(start: Instant, ms: u64) -> Instant {
        start + Duration::from_millis(ms)
    }

    #[test]
    fn a_tap_starts_and_the_next_tap_stops_ignoring_the_starts_bounce() {
        let t = Instant::now();
        let mut gesture = Gesture::default();
        assert_eq!(gesture.press(t), Pressed::Act(Action::Start));
        // Key repeat while held, then the release: nothing.
        assert_eq!(gesture.press(ms(t, 30)), Pressed::Nothing);
        assert_eq!(gesture.release(ms(t, 80)), None);
        // A bounce within 400 ms of the start is ignored, release included.
        assert_eq!(gesture.press(ms(t, 300)), Pressed::Nothing);
        assert_eq!(gesture.release(ms(t, 350)), None);
        let Pressed::WaitForHold(id) = gesture.press(ms(t, 2_000)) else {
            panic!("a press while recording waits for the hold")
        };
        assert_eq!(gesture.release(ms(t, 2_100)), Some(Action::Stop));
        // The hold check of a tap that already stopped does nothing.
        assert_eq!(gesture.held(id), None);
        assert_eq!(gesture.press(ms(t, 3_000)), Pressed::Act(Action::Start));
    }

    #[test]
    fn a_hold_while_recording_inks_until_release_and_never_stops() {
        let t = Instant::now();
        let mut gesture = Gesture::default();
        gesture.set_recording(true, t);
        let Pressed::WaitForHold(id) = gesture.press(ms(t, 1_000)) else {
            panic!("waits for the hold")
        };
        assert_eq!(gesture.held(id), Some(Action::InkOn));
        assert_eq!(gesture.held(id), None);
        assert_eq!(gesture.release(ms(t, 5_000)), Some(Action::InkOff));
        // Still recording: the next tap stops.
        gesture.press(ms(t, 6_000));
        assert_eq!(gesture.release(ms(t, 6_050)), Some(Action::Stop));

        // A hold check that came late still keeps a long press from stopping.
        gesture.set_recording(true, ms(t, 7_000));
        gesture.press(ms(t, 8_000));
        assert_eq!(gesture.release(ms(t, 8_400)), None);
    }

    #[test]
    fn a_recording_that_ended_elsewhere_lets_the_next_press_start() {
        let t = Instant::now();
        let mut gesture = Gesture::default();
        assert_eq!(gesture.press(t), Pressed::Act(Action::Start));
        gesture.release(ms(t, 50));
        // The capsule stopped it, or the start failed.
        gesture.set_recording(false, ms(t, 900));
        assert_eq!(gesture.press(ms(t, 1_000)), Pressed::Act(Action::Start));
    }
}
