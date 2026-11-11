use crate::records;

/// An output that can be muted.
pub(crate) trait Mute {
    /// None when the state cannot be read.
    fn muted(&self) -> Option<bool>;
    fn set_muted(&mut self, muted: bool) -> bool;
    /// Finds the same output, and how to unmute it, after a crash.
    fn record(&self) -> records::Muted;
}

/// Holds an output muted until dropped.
pub(crate) struct Guard<M: Mute>(M);

impl<M: Mute> Guard<M> {
    /// Leaves an output that is muted already, or whose state is unknown,
    /// alone, so an output the user muted is never unmuted later.
    pub(crate) fn start(mut output: M) -> Option<Self> {
        if output.muted() != Some(false) {
            return None;
        }
        // Recorded first: a crash right after muting must still find it.
        records::remember_mute(output.record());
        if output.set_muted(true) {
            Some(Self(output))
        } else {
            records::forget_mute();
            None
        }
    }
}

impl<M: Mute> Drop for Guard<M> {
    /// Unmutes only an output that is still muted: one the user unmuted
    /// meanwhile, or raised from a zero volume, keeps their choice.
    fn drop(&mut self) {
        if self.0.muted() == Some(true) && !self.0.set_muted(false) {
            tracing::warn!("could not unmute the output after dictation");
        }
        records::forget_mute();
    }
}

/// Unmutes an output a crashed run left muted, if it still is.
pub(crate) fn recover(output: &mut impl Mute) {
    if output.muted() == Some(true) && output.set_muted(false) {
        tracing::info!("unmuted the output a previous run left muted");
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::rc::Rc;

    use super::*;

    struct Fake(Rc<Cell<bool>>);

    impl Mute for Fake {
        fn muted(&self) -> Option<bool> {
            Some(self.0.get())
        }

        fn set_muted(&mut self, muted: bool) -> bool {
            self.0.set(muted);
            true
        }

        fn record(&self) -> records::Muted {
            records::Muted {
                output: "fake".into(),
                previous_volume: None,
            }
        }
    }

    #[test]
    fn an_output_muted_before_dictation_stays_muted_after_it() {
        let output = Rc::new(Cell::new(true));
        assert!(Guard::start(Fake(output.clone())).is_none());
        assert!(output.get());

        output.set(false);
        let guard = Guard::start(Fake(output.clone())).unwrap();
        assert!(output.get());
        drop(guard);
        assert!(!output.get());
    }
}
