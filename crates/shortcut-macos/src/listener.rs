use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use crate::{
    double_tap::{DoubleTapDetector, DoubleTapOutput, ModifierKey},
    hotkey::HotKey,
    processor::{HotKeyProcessor, Options, Output},
    tap::{EventTap, TapError, TapEvent},
};

pub struct Listener {
    _tap: EventTap,
}

impl Listener {
    pub fn start<F>(hotkey: HotKey, options: Options, callback: F) -> Result<Self, TapError>
    where
        F: Fn(Output) + Send + Sync + 'static,
    {
        let processor = Arc::new(Mutex::new({
            let mut p = HotKeyProcessor::new(hotkey);
            p.set_options(options);
            p
        }));

        let tap = EventTap::start_filtered(move |event| {
            let (out, consume) = {
                let mut p = processor.lock().unwrap_or_else(|e| e.into_inner());
                let out = match event {
                    TapEvent::Key(k) => p.process_key(k),
                    TapEvent::MouseClick => p.process_mouse_click(),
                };
                let consume = hotkey.is_modifier_only()
                    && matches!(event, TapEvent::Key(k) if k.key.is_none())
                    && out.is_some();
                (out, consume)
            };
            if let Some(out) = out {
                callback(out);
            }
            consume
        })?;

        Ok(Self { _tap: tap })
    }

    /// Reports a double tap of `key`; while `active` is set, one press is
    /// enough. Key events still reach the focused app.
    pub fn start_double_tap<F>(
        key: ModifierKey,
        active: Arc<AtomicBool>,
        callback: F,
    ) -> Result<Self, TapError>
    where
        F: Fn(DoubleTapOutput) + Send + Sync + 'static,
    {
        let detector = Mutex::new(DoubleTapDetector::new(key));
        let tap = EventTap::start(move |event| {
            let out = {
                let mut detector = detector.lock().unwrap_or_else(|e| e.into_inner());
                match event {
                    TapEvent::Key(k) => detector.process_key(k, active.load(Ordering::SeqCst)),
                    TapEvent::MouseClick => {
                        detector.process_mouse_click();
                        None
                    }
                }
            };
            if let Some(out) = out {
                callback(out);
            }
        })?;

        Ok(Self { _tap: tap })
    }
}
