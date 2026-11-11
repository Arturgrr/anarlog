//! "Lower audio": a relative, channel-preserving volume ramp over each OS's
//! output volume, adapted from Hex's output ducking. Only the ramp's own
//! thread waits for it; the caller and the worker never wait for lowering.

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::records;

const TICK: Duration = Duration::from_millis(16);
const EPSILON: f32 = 0.002;
/// How far a volume read back after a crash may sit from where the ramp
/// would have put it: drivers round the scalars they store.
const RECOVERY_TOLERANCE: f32 = 0.01;

/// Volumes lowered and restored together, such as an output's channels.
pub(crate) trait Volume {
    fn read(&self) -> Option<Vec<f32>>;
    fn write(&mut self, values: &[f32]) -> bool;
    /// Finds the same output again after a crash.
    fn id(&self) -> String;
}

/// Holds the output lowered to `factor` of its volume until dropped.
pub(crate) struct Guard {
    stop: Sender<()>,
    worker: Option<JoinHandle<()>>,
}

impl Guard {
    /// Lowers what `open` returns, opened on the ramp's own thread.
    pub(crate) fn start<V: Volume>(
        factor: f32,
        open: impl FnOnce() -> Option<V> + Send + 'static,
    ) -> Option<Self> {
        let (stop, receiver) = mpsc::channel();
        let worker = thread::Builder::new()
            .name("output-ducking".into())
            .spawn(move || {
                let Some(mut ramp) = open().and_then(Ramp::new) else {
                    return;
                };
                records::remember_duck(records::Ducked {
                    output: ramp.output.id(),
                    original: ramp.original.clone(),
                    volume: factor,
                });
                run(&mut ramp, factor, receiver);
                records::forget_duck();
            })
            .inspect_err(|error| tracing::warn!(%error, "could not start lowering the output"))
            .ok()?;
        Some(Self {
            stop,
            worker: Some(worker),
        })
    }
}

impl Drop for Guard {
    /// Ramps the volume back and returns once it is restored.
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn run<V: Volume>(ramp: &mut Ramp<V>, factor: f32, receiver: Receiver<()>) {
    ramp.retarget(Some(factor));
    let started = Instant::now();
    loop {
        match receiver.recv_timeout(TICK) {
            Ok(()) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => ramp.tick(started.elapsed().as_secs_f32()),
        }
        if ramp.finished {
            return;
        }
    }
    ramp.retarget(None);
    let started = Instant::now();
    while !ramp.finished {
        ramp.tick(started.elapsed().as_secs_f32());
        if !ramp.finished {
            thread::sleep(TICK);
        }
    }
}

struct Ramp<V: Volume> {
    output: V,
    original: Vec<f32>,
    accepted: Vec<f32>,
    from: Vec<f32>,
    target: Vec<f32>,
    restoring: bool,
    settled: bool,
    finished: bool,
}

fn close(a: &[f32], b: &[f32]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(a, b)| (a - b).abs() < EPSILON)
}

impl<V: Volume> Ramp<V> {
    fn new(output: V) -> Option<Self> {
        let original = output.read().filter(|values| !values.is_empty())?;
        Some(Self {
            output,
            accepted: original.clone(),
            from: original.clone(),
            target: original.clone(),
            original,
            restoring: false,
            settled: false,
            finished: false,
        })
    }

    fn retarget(&mut self, factor: Option<f32>) {
        if self.finished {
            return;
        }
        if self.settled
            && !self
                .output
                .read()
                .is_some_and(|values| close(&values, &self.accepted))
        {
            // Someone changed the volume after the ramp settled: theirs wins.
            self.finished = true;
            return;
        }
        self.from = self.output.read().unwrap_or_else(|| self.accepted.clone());
        self.target = self
            .original
            .iter()
            .map(|value| value * factor.unwrap_or(1.0))
            .collect();
        self.restoring = factor.is_none();
        self.settled = false;
    }

    fn tick(&mut self, seconds: f32) {
        if self.finished || self.settled {
            return;
        }
        let t = seconds.clamp(0.0, 1.0);
        let eased = t * t * (3.0 - 2.0 * t);
        let values: Vec<_> = self
            .from
            .iter()
            .zip(&self.target)
            .map(|(from, to)| from + (to - from) * eased)
            .collect();
        if !self.output.write(&values) {
            self.rollback();
            return;
        }
        let Some(actual) = self.output.read() else {
            self.rollback();
            return;
        };
        // Bluetooth outputs may acknowledge channels late: settle within a bound.
        self.accepted = actual;
        if t >= 1.0 && (close(&self.accepted, &self.target) || seconds >= 1.5) {
            self.settled = true;
            self.finished = self.restoring;
        }
    }

    fn rollback(&mut self) {
        self.output.write(&self.original);
        self.finished = true;
    }
}

/// Puts back an output a crashed run left lowered, unless its volume moved
/// since: every channel must still sit at one point of that run's ramp.
pub(crate) fn recover(output: &mut impl Volume, ducked: &records::Ducked) {
    let Some(current) = output.read() else {
        return;
    };
    if still_lowered(&ducked.original, ducked.volume, &current) && output.write(&ducked.original) {
        tracing::info!("restored the output volume a previous run left lowered");
    }
}

fn still_lowered(original: &[f32], factor: f32, current: &[f32]) -> bool {
    if original.len() != current.len() {
        return false;
    }
    let Some((loudest, &reference)) = original
        .iter()
        .enumerate()
        .max_by(|(_, a), (_, b)| a.total_cmp(b))
    else {
        return false;
    };
    if reference <= RECOVERY_TOLERANCE {
        return false;
    }
    let position = current[loudest] / reference;
    position >= factor - RECOVERY_TOLERANCE
        && position < 1.0 - RECOVERY_TOLERANCE
        && original
            .iter()
            .zip(current)
            .all(|(original, current)| (original * position - current).abs() < RECOVERY_TOLERANCE)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fake {
        values: Vec<f32>,
        fail: bool,
    }

    impl Volume for Fake {
        fn read(&self) -> Option<Vec<f32>> {
            Some(self.values.clone())
        }

        fn write(&mut self, values: &[f32]) -> bool {
            self.values[0] = values[0];
            if std::mem::take(&mut self.fail) {
                return false;
            }
            self.values = values
                .iter()
                .map(|value| (value * 1000.0).round() / 1000.0)
                .collect();
            true
        }

        fn id(&self) -> String {
            "fake".into()
        }
    }

    fn ramp(values: &[f32]) -> Ramp<Fake> {
        Ramp::new(Fake {
            values: values.to_vec(),
            fail: false,
        })
        .unwrap()
    }

    #[test]
    fn lowering_keeps_the_balance_and_silent_channels_and_restores_them() {
        for original in [&[0.3, 0.8][..], &[0.0, 0.8], &[0.5]] {
            for factor in [0.0, 0.2, 1.0] {
                let mut ramp = ramp(original);
                ramp.retarget(Some(factor));
                ramp.tick(0.5);
                let halfway: Vec<_> = original
                    .iter()
                    .map(|value| value * (1.0 + factor) / 2.0)
                    .collect();
                assert!(close(&ramp.output.values, &halfway));
                ramp.tick(1.0);
                ramp.retarget(None);
                ramp.tick(1.0);
                assert!(close(&ramp.output.values, original));
                assert!(ramp.finished);
            }
        }
    }

    #[test]
    fn a_volume_changed_by_hand_is_kept_and_an_interrupted_ramp_is_restored() {
        let mut changed = ramp(&[0.3, 0.8]);
        changed.retarget(Some(0.2));
        changed.tick(1.0);
        changed.output.values = vec![0.5, 0.5];
        changed.retarget(None);
        changed.tick(1.0);
        assert_eq!(changed.output.values, vec![0.5, 0.5]);

        let mut interrupted = ramp(&[0.3, 0.8]);
        interrupted.retarget(Some(0.0));
        interrupted.tick(0.1);
        interrupted.retarget(None);
        interrupted.tick(1.0);
        assert!(close(&interrupted.output.values, &[0.3, 0.8]));
    }

    #[test]
    fn a_partial_write_failure_rolls_every_channel_back() {
        let mut ramp = ramp(&[0.3, 0.8]);
        ramp.output.fail = true;
        ramp.retarget(Some(0.2));
        ramp.tick(0.5);
        assert!(ramp.finished);
        assert!(close(&ramp.output.values, &[0.3, 0.8]));
    }

    #[test]
    fn a_crash_while_lowered_is_restored_only_while_the_volume_is_where_the_ramp_left_it() {
        let original = [0.4, 0.8];
        for (current, restored) in [
            (&[0.08, 0.16][..], true),
            (&[0.24, 0.48], true),
            (&[0.5, 0.5], false),
            (&[0.04, 0.08], false),
            (&[0.4, 0.8], false),
            (&[0.08], false),
        ] {
            let mut output = Fake {
                values: current.to_vec(),
                fail: false,
            };
            recover(
                &mut output,
                &records::Ducked {
                    output: "fake".into(),
                    original: original.to_vec(),
                    volume: 0.2,
                },
            );
            let expected = if restored { &original[..] } else { current };
            assert!(close(&output.values, expected), "{current:?}");
        }
    }
}
