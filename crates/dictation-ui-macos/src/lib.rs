use std::time::Duration;

use swift_rs::{Bool, SRString, swift};

swift!(fn _dictation_hud_prewarm());
swift!(fn _dictation_hud_event(json: &SRString) -> Bool);
swift!(fn _dictation_hud_meter(rms: f64));
swift!(fn _capture_dictation_target() -> SRString);
swift!(fn _insert_dictation_text(target: &SRString, text: &SRString) -> SRString);
swift!(fn _wait_for_dictation_paste_read(timeout: f64) -> Bool);

pub fn capture_target() -> Result<String, String> {
    let value = unsafe { _capture_dictation_target() }.to_string();
    value.strip_prefix("ok:").map(str::to_owned).ok_or(value)
}

pub fn insert_text(target: &str, text: &str) -> Result<(), String> {
    let value = unsafe { _insert_dictation_text(&SRString::from(target), &SRString::from(text)) }
        .to_string();
    if value.is_empty() { Ok(()) } else { Err(value) }
}

/// Waits up to `timeout` for the app to read the text the last
/// [`insert_text`] pasted. True once it has, or when that insertion pasted
/// nothing. Call it off the main thread, where the read arrives.
pub fn wait_for_paste_read(timeout: Duration) -> bool {
    unsafe { _wait_for_dictation_paste_read(timeout.as_secs_f64()) }
}

/// Builds the HUD's panel and compiles its shader ahead of the first
/// dictation.
pub fn prewarm_hud() {
    unsafe { _dictation_hud_prewarm() }
}

/// Hands the HUD one event as JSON (`{"type": "started"}`, …). Returns
/// whether the HUD could take it; a `started` it can't show returns false.
pub fn hud_event(json: &str) -> bool {
    swift_rs::autoreleasepool!({
        let json = SRString::from(json);
        unsafe { _dictation_hud_event(&json) }
    })
}

/// The microphone's RMS for one captured buffer.
pub fn hud_meter(rms: f32) {
    unsafe { _dictation_hud_meter(f64::from(rms)) }
}
