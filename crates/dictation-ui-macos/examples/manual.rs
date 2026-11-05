mod common;

use std::time::Duration;

use dictation_ui_macos::{hud_event, hud_meter, prewarm_hud};

/// Records for four seconds of synthetic syllables, transcribes, finishes;
/// then records again and fails.
fn main() {
    common::run_app(|| {
        prewarm_hud();
        std::thread::sleep(Duration::from_millis(300));
        for outcome in ["completed", "failed"] {
            if !hud_event(r#"{"type":"started"}"#) {
                eprintln!("the HUD could not show");
                std::process::exit(1);
            }
            for i in 0..200 {
                let t = i as f32 * 0.02;
                let syllable = (t * 4.5 * std::f32::consts::TAU).sin().max(0.0);
                let db = -58.0 + 28.0 * syllable.powf(0.6) * (t % 2.4 < 1.7) as u8 as f32;
                hud_meter(10_f32.powf(db / 20.0));
                if i == 60 {
                    hud_event(
                        r#"{"type":"preview","stable":"So the plan","tentative":" for today"}"#,
                    );
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            hud_event(r#"{"type":"processing"}"#);
            std::thread::sleep(Duration::from_millis(1200));
            hud_event(&format!(r#"{{"type":"{outcome}"}}"#));
            std::thread::sleep(Duration::from_millis(1500));
        }
        std::process::exit(0);
    });
}
