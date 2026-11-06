use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use crate::{
    processor::Output,
    tap::{EventTap, TapError},
    trigger::{Trigger, TriggerSet},
};

pub struct Listener {
    _tap: EventTap,
}

impl Listener {
    /// Watches every trigger with one event tap and reports outputs by the
    /// trigger's index. While `active` is set, one press of a double-tap key
    /// is enough. Only modifier-only hotkeys that fire are kept from the
    /// focused app.
    pub fn start<F>(
        triggers: &[Trigger],
        active: Arc<AtomicBool>,
        callback: F,
    ) -> Result<Self, TapError>
    where
        F: Fn(usize, Output) + Send + Sync + 'static,
    {
        let set = Mutex::new(TriggerSet::new(triggers));
        let tap = EventTap::start_filtered(move |event| {
            let (outputs, consume) = set
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .process(event, active.load(Ordering::SeqCst));
            for (index, output) in outputs {
                callback(index, output);
            }
            consume
        })?;

        Ok(Self { _tap: tap })
    }
}
