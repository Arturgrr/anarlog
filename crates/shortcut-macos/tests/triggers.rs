use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use shortcut_macos::{
    Clock, HotKey, KeyEvent, Modifier, ModifierChange, ModifierKey, Modifiers, Options, Output,
    TapEvent, Trigger, TriggerSet,
};

const FN: u16 = 0x3F;
const LEFT_OPTION: u16 = 0x3A;

struct MockClock {
    start: Instant,
    offset_ms: Mutex<u64>,
}

impl Clock for MockClock {
    fn now(&self) -> Instant {
        self.start + Duration::from_millis(*self.offset_ms.lock().unwrap())
    }
}

fn modifier(keycode: u16, held: &[Modifier], down: bool) -> TapEvent {
    TapEvent::Key(
        KeyEvent::new(None, Modifiers::from_slice(held)).with_modifier_change(if down {
            ModifierChange::Down(keycode)
        } else {
            ModifierChange::Up(keycode)
        }),
    )
}

#[test]
fn one_tap_reports_fn_and_a_left_option_double_tap_by_their_own_index() {
    let clock = Arc::new(MockClock {
        start: Instant::now(),
        offset_ms: Mutex::new(0),
    });
    let mut set = TriggerSet::with_clock(
        &[
            Trigger::HotKey {
                hotkey: HotKey::modifier_only(Modifiers::from([Modifier::Fn])),
                options: Options {
                    double_tap_lock_enabled: false,
                    ..Default::default()
                },
            },
            Trigger::DoubleTap(ModifierKey::LeftOption),
        ],
        clock.clone(),
    );
    let mut at = |ms: u64, event: TapEvent| {
        *clock.offset_ms.lock().unwrap() = ms;
        set.process(event, false)
    };

    assert_eq!(
        at(0, modifier(FN, &[Modifier::Fn], true)),
        (vec![(0, Output::StartRecording)], true)
    );
    assert_eq!(
        at(600, modifier(FN, &[], false)).0,
        vec![(0, Output::StopRecording)]
    );

    assert_eq!(
        at(1000, modifier(LEFT_OPTION, &[Modifier::Option], true)),
        (vec![], false)
    );
    assert_eq!(at(1080, modifier(LEFT_OPTION, &[], false)), (vec![], false));
    // A double tap is reported but still reaches the focused app.
    assert_eq!(
        at(1200, modifier(LEFT_OPTION, &[Modifier::Option], true)),
        (vec![(1, Output::StartRecording)], false)
    );
    assert_eq!(
        at(1500, modifier(LEFT_OPTION, &[], false)),
        (vec![(1, Output::StopRecording)], false)
    );
}
