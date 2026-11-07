use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use shortcut_macos::{
    Clock, DoubleTapDetector, DoubleTapOutput, KeyEvent, Modifier, ModifierChange, ModifierKey,
    Modifiers,
};

const LEFT_OPTION: u16 = 0x3A;
const RIGHT_OPTION: u16 = 0x3D;
const K_E: u16 = 0x0E;

struct MockClock {
    start: Instant,
    offset_ms: Mutex<u64>,
}

impl Clock for MockClock {
    fn now(&self) -> Instant {
        self.start + Duration::from_millis(*self.offset_ms.lock().unwrap())
    }
}

struct Keyboard {
    clock: Arc<MockClock>,
    detector: DoubleTapDetector,
    active: bool,
}

impl Keyboard {
    fn new() -> Self {
        let clock = Arc::new(MockClock {
            start: Instant::now(),
            offset_ms: Mutex::new(0),
        });
        Self {
            detector: DoubleTapDetector::with_clock(ModifierKey::LeftOption, clock.clone()),
            clock,
            active: false,
        }
    }

    fn at(&mut self, ms: u64) -> &mut Self {
        *self.clock.offset_ms.lock().unwrap() = ms;
        self
    }

    fn option(&mut self, keycode: u16, down: bool) -> Option<DoubleTapOutput> {
        let modifiers = if down {
            Modifiers::from([Modifier::Option])
        } else {
            Modifiers::empty()
        };
        let change = if down {
            ModifierChange::Down(keycode)
        } else {
            ModifierChange::Up(keycode)
        };
        self.detector.process_key(
            KeyEvent::new(None, modifiers).with_modifier_change(change),
            self.active,
        )
    }

    fn key(&mut self, keycode: u16, modifiers: Modifiers) -> Option<DoubleTapOutput> {
        self.detector
            .process_key(KeyEvent::new(Some(keycode), modifiers), self.active)
    }
}

#[test]
fn a_double_tap_of_left_option_presses_until_the_second_release() {
    let mut kb = Keyboard::new();
    assert_eq!(kb.at(0).option(LEFT_OPTION, true), None);
    assert_eq!(kb.at(80).option(LEFT_OPTION, false), None);
    assert_eq!(
        kb.at(200).option(LEFT_OPTION, true),
        Some(DoubleTapOutput::Pressed)
    );
    assert_eq!(
        kb.at(1500).option(LEFT_OPTION, false),
        Some(DoubleTapOutput::Released)
    );

    // A single tap afterwards is not a shortcut.
    assert_eq!(kb.at(3000).option(LEFT_OPTION, true), None);
    assert_eq!(kb.at(3080).option(LEFT_OPTION, false), None);
}

#[test]
fn slow_taps_typing_and_the_other_option_key_do_not_trigger() {
    let mut kb = Keyboard::new();

    // Taps too far apart.
    kb.at(0).option(LEFT_OPTION, true);
    kb.at(80).option(LEFT_OPTION, false);
    assert_eq!(kb.at(900).option(LEFT_OPTION, true), None);
    kb.at(980).option(LEFT_OPTION, false);

    // Option used to type a character.
    kb.at(5000).option(LEFT_OPTION, true);
    kb.at(5050).key(K_E, Modifiers::from([Modifier::Option]));
    kb.at(5100).option(LEFT_OPTION, false);
    assert_eq!(kb.at(5200).option(LEFT_OPTION, true), None);
    kb.at(5280).option(LEFT_OPTION, false);

    // The right Option key is a different key.
    kb.at(9000).option(RIGHT_OPTION, true);
    kb.at(9080).option(RIGHT_OPTION, false);
    assert_eq!(kb.at(9200).option(RIGHT_OPTION, true), None);
    kb.at(9280).option(RIGHT_OPTION, false);
}

#[test]
fn one_press_ends_an_active_dictation() {
    let mut kb = Keyboard::new();
    kb.active = true;
    assert_eq!(
        kb.at(0).option(LEFT_OPTION, true),
        Some(DoubleTapOutput::Pressed)
    );
    assert_eq!(
        kb.at(90).option(LEFT_OPTION, false),
        Some(DoubleTapOutput::Released)
    );
}
