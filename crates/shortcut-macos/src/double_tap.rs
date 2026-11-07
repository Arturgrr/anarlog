use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use crate::{
    hotkey::{Modifier, Modifiers},
    key_event::{KeyEvent, ModifierChange},
    processor::{Clock, SystemClock},
};

/// A tap is a press of the key alone, released within this time.
pub const TAP_MAX_HOLD: Duration = Duration::from_millis(400);
/// The second press has to follow the first tap's release within this time.
pub const DOUBLE_TAP_GAP: Duration = Duration::from_millis(400);

/// One physical modifier key; left and right are separate keys.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ModifierKey {
    LeftOption,
    RightOption,
    LeftCommand,
    RightCommand,
    LeftControl,
    RightControl,
    LeftShift,
    RightShift,
}

impl ModifierKey {
    pub const fn keycode(self) -> u16 {
        match self {
            Self::LeftOption => 0x3A,
            Self::RightOption => 0x3D,
            Self::LeftCommand => 0x37,
            Self::RightCommand => 0x36,
            Self::LeftControl => 0x3B,
            Self::RightControl => 0x3E,
            Self::LeftShift => 0x38,
            Self::RightShift => 0x3C,
        }
    }

    const fn modifier(self) -> Modifier {
        match self {
            Self::LeftOption | Self::RightOption => Modifier::Option,
            Self::LeftCommand | Self::RightCommand => Modifier::Command,
            Self::LeftControl | Self::RightControl => Modifier::Control,
            Self::LeftShift | Self::RightShift => Modifier::Shift,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DoubleTapOutput {
    Pressed,
    Released,
}

#[derive(Debug, Clone, Copy)]
struct Hold {
    since: Instant,
    alone: bool,
    reported: bool,
}

/// Turns a double tap of one modifier key into `Pressed`, and the release of
/// that second press into `Released`. While a dictation is active a single
/// press is enough, so the same key can end it.
pub struct DoubleTapDetector {
    key: ModifierKey,
    hold: Option<Hold>,
    last_tap: Option<Instant>,
    clock: Arc<dyn Clock>,
}

impl DoubleTapDetector {
    pub fn new(key: ModifierKey) -> Self {
        Self::with_clock(key, Arc::new(SystemClock))
    }

    pub fn with_clock(key: ModifierKey, clock: Arc<dyn Clock>) -> Self {
        Self {
            key,
            hold: None,
            last_tap: None,
            clock,
        }
    }

    pub fn process_key(&mut self, event: KeyEvent, active: bool) -> Option<DoubleTapOutput> {
        let code = self.key.keycode();
        match event.modifier_change {
            Some(ModifierChange::Down(changed)) if changed == code => {
                let now = self.clock.now();
                let alone = event
                    .modifiers
                    .removing(Modifier::RightCommand)
                    .matches_exactly(Modifiers::from([self.key.modifier()]));
                let second = self
                    .last_tap
                    .take()
                    .is_some_and(|tap| now.saturating_duration_since(tap) <= DOUBLE_TAP_GAP);
                let reported = alone && (active || second);
                self.hold = Some(Hold {
                    since: now,
                    alone,
                    reported,
                });
                reported.then_some(DoubleTapOutput::Pressed)
            }
            Some(ModifierChange::Up(changed)) if changed == code => {
                let hold = self.hold.take()?;
                if hold.reported {
                    return Some(DoubleTapOutput::Released);
                }
                let held = self.clock.now().saturating_duration_since(hold.since);
                if hold.alone && held <= TAP_MAX_HOLD {
                    self.last_tap = Some(self.clock.now());
                }
                None
            }
            Some(ModifierChange::Up(_)) => None,
            Some(ModifierChange::Down(_)) => {
                self.interrupt();
                None
            }
            None if event.key.is_some() => {
                self.interrupt();
                None
            }
            None => None,
        }
    }

    pub fn process_mouse_click(&mut self) {
        self.last_tap = None;
    }

    fn interrupt(&mut self) {
        self.last_tap = None;
        if let Some(hold) = &mut self.hold {
            hold.alone = false;
        }
    }
}
