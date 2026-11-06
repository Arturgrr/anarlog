use std::sync::Arc;

use crate::{
    double_tap::{DoubleTapDetector, DoubleTapOutput, ModifierKey},
    hotkey::HotKey,
    processor::{Clock, HotKeyProcessor, Options, Output, SystemClock},
    tap::TapEvent,
};

/// One native shortcut that a single event tap watches for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    HotKey { hotkey: HotKey, options: Options },
    DoubleTap(ModifierKey),
}

enum Detector {
    HotKey(HotKeyProcessor),
    DoubleTap(DoubleTapDetector),
}

/// Runs every trigger on each tap event, so several shortcuts share one tap.
pub struct TriggerSet {
    detectors: Vec<Detector>,
}

impl TriggerSet {
    pub fn new(triggers: &[Trigger]) -> Self {
        Self::with_clock(triggers, Arc::new(SystemClock))
    }

    pub fn with_clock(triggers: &[Trigger], clock: Arc<dyn Clock>) -> Self {
        let detectors = triggers
            .iter()
            .map(|trigger| match *trigger {
                Trigger::HotKey { hotkey, options } => {
                    let mut processor = HotKeyProcessor::with_clock(hotkey, clock.clone());
                    processor.set_options(options);
                    Detector::HotKey(processor)
                }
                Trigger::DoubleTap(key) => {
                    Detector::DoubleTap(DoubleTapDetector::with_clock(key, clock.clone()))
                }
            })
            .collect();
        Self { detectors }
    }

    /// Returns each trigger's output by its index, and whether the event
    /// should be kept from the focused app.
    pub fn process(&mut self, event: TapEvent, active: bool) -> (Vec<(usize, Output)>, bool) {
        let mut outputs = Vec::new();
        let mut consume = false;
        for (index, detector) in self.detectors.iter_mut().enumerate() {
            let output = match (detector, event) {
                (Detector::HotKey(processor), TapEvent::Key(key)) => {
                    let output = processor.process_key(key);
                    consume |= output.is_some()
                        && processor.hotkey().is_modifier_only()
                        && key.key.is_none();
                    output
                }
                (Detector::HotKey(processor), TapEvent::MouseClick) => {
                    processor.process_mouse_click()
                }
                (Detector::DoubleTap(detector), TapEvent::Key(key)) => detector
                    .process_key(key, active)
                    .map(|output| match output {
                        DoubleTapOutput::Pressed => Output::StartRecording,
                        DoubleTapOutput::Released => Output::StopRecording,
                    }),
                (Detector::DoubleTap(detector), TapEvent::MouseClick) => {
                    detector.process_mouse_click();
                    None
                }
            };
            if let Some(output) = output {
                outputs.push((index, output));
            }
        }
        (outputs, consume)
    }
}
