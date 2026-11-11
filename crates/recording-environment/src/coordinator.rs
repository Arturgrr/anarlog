//! The worker that owns every change. Each kind of change is held from the
//! first session that wants it until the last one ends, so overlapping
//! sessions with different settings compose and none restores what another
//! still needs, and a later session never mistakes the quieted output for
//! the original. Adapted from Hex's recording environment.

use std::collections::HashMap;
use std::panic::AssertUnwindSafe;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

pub(crate) type Callback = Box<dyn FnOnce() + Send>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Kind {
    Mute,
    Duck,
    Pause,
    Sleep,
}

impl Kind {
    /// Both acquisition and restoration order: the output goes quiet, and
    /// comes back, before anything waits on a media player or the OS.
    const ALL: [Self; 4] = [Self::Mute, Self::Duck, Self::Pause, Self::Sleep];

    const fn index(self) -> usize {
        self as usize
    }

    const fn silences_output(self) -> bool {
        matches!(self, Self::Mute | Self::Duck)
    }

    const fn quiets_audio(self) -> bool {
        !matches!(self, Self::Sleep)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Effect {
    Mute,
    Duck { volume: f32 },
    Pause { browsers: bool },
    Sleep,
}

impl Effect {
    pub(crate) const fn kind(self) -> Kind {
        match self {
            Self::Mute => Kind::Mute,
            Self::Duck { .. } => Kind::Duck,
            Self::Pause { .. } => Kind::Pause,
            Self::Sleep => Kind::Sleep,
        }
    }
}

/// Changes the environment for one effect; dropping what `hold` returns
/// restores it. Runs on the worker thread only.
pub(crate) trait Environment {
    type Held;
    fn hold(&mut self, effect: Effect) -> Self::Held;
}

pub(crate) enum Command {
    Begin {
        session: u64,
        effects: Vec<Effect>,
        /// Holds the effects back this long, unless other audio is still
        /// quiet from an earlier session.
        delay: Duration,
    },
    End {
        session: u64,
        then: Option<Callback>,
    },
    Run(Callback),
    Shutdown(Sender<()>),
    #[cfg(test)]
    Barrier(Sender<()>),
}

pub(crate) fn spawn<E: Environment + 'static>(
    grace: Duration,
    environment: impl FnOnce() -> E + Send + 'static,
) -> std::io::Result<Sender<Command>> {
    let (commands, receiver) = mpsc::channel();
    std::thread::Builder::new()
        .name("recording-environment".into())
        .spawn(move || Worker::new(environment(), grace).serve(receiver))?;
    Ok(commands)
}

struct Worker<E: Environment> {
    environment: E,
    grace: Duration,
    sessions: HashMap<u64, Vec<Effect>>,
    /// Sessions waiting out their delay, and when it ends.
    deferred: HashMap<u64, (Vec<Effect>, Instant)>,
    held: [Option<E::Held>; Kind::ALL.len()],
    release_at: [Option<Instant>; Kind::ALL.len()],
    /// `end_then` callbacks waiting for the output to be audible again.
    waiting: Vec<Callback>,
}

impl<E: Environment> Worker<E> {
    fn new(environment: E, grace: Duration) -> Self {
        Self {
            environment,
            grace,
            sessions: HashMap::new(),
            deferred: HashMap::new(),
            held: std::array::from_fn(|_| None),
            release_at: [None; Kind::ALL.len()],
            waiting: Vec::new(),
        }
    }

    fn serve(mut self, commands: Receiver<Command>) {
        loop {
            let next = match self
                .release_at
                .iter()
                .flatten()
                .chain(self.deferred.values().map(|(_, at)| at))
                .min()
            {
                Some(&deadline) => {
                    match commands.recv_timeout(deadline.saturating_duration_since(Instant::now()))
                    {
                        Ok(command) => Some(command),
                        Err(RecvTimeoutError::Timeout) => None,
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                }
                None => match commands.recv() {
                    Ok(command) => Some(command),
                    Err(_) => break,
                },
            };
            if let Some(command) = next {
                self.handle(command);
            }
            let now = Instant::now();
            self.begin_due(now);
            self.release_due(now);
        }
        self.release_all();
    }

    fn handle(&mut self, command: Command) {
        match command {
            Command::Begin {
                session,
                effects,
                delay,
            } => {
                // Waiting while an earlier session still keeps other audio
                // down would let it come back in between: back-to-back
                // captures take it over at once instead.
                if delay.is_zero() || self.quiet() {
                    self.begin(session, effects);
                } else {
                    self.deferred
                        .insert(session, (effects, Instant::now() + delay));
                }
            }
            Command::End { session, then } => {
                self.deferred.remove(&session);
                if let Some(effects) = self.sessions.remove(&session) {
                    let release_at = Instant::now() + self.grace;
                    for kind in effects.iter().map(|effect| effect.kind()) {
                        if !self.wanted(kind) && self.held[kind.index()].is_some() {
                            self.release_at[kind.index()] = Some(release_at);
                        }
                    }
                }
                if let Some(then) = then {
                    if self.output_pending_release() {
                        self.waiting.push(then);
                    } else {
                        contained("an end callback", then);
                    }
                }
            }
            Command::Run(work) => {
                contained("restoring a previous run's audio", work);
            }
            Command::Shutdown(done) => {
                self.sessions.clear();
                self.deferred.clear();
                self.release_all();
                let _ = done.send(());
            }
            #[cfg(test)]
            Command::Barrier(reply) => {
                let _ = reply.send(());
            }
        }
    }

    fn begin(&mut self, session: u64, effects: Vec<Effect>) {
        for kind in Kind::ALL {
            let Some(&effect) = effects.iter().find(|effect| effect.kind() == kind) else {
                continue;
            };
            if self.held[kind.index()].is_some() {
                self.release_at[kind.index()] = None;
            } else {
                let environment = &mut self.environment;
                self.held[kind.index()] =
                    contained("changing the environment", || environment.hold(effect));
            }
        }
        self.sessions.insert(session, effects);
    }

    fn begin_due(&mut self, now: Instant) {
        let due: Vec<_> = self.deferred.extract_if(|_, (_, at)| *at <= now).collect();
        for (session, (effects, _)) in due {
            self.begin(session, effects);
        }
    }

    /// Whether other audio is still muted, lowered or paused for a session,
    /// live or within its grace.
    fn quiet(&self) -> bool {
        Kind::ALL
            .into_iter()
            .filter(|kind| kind.quiets_audio())
            .any(|kind| self.held[kind.index()].is_some())
    }

    fn wanted(&self, kind: Kind) -> bool {
        self.sessions
            .values()
            .flatten()
            .any(|effect| effect.kind() == kind)
    }

    fn output_pending_release(&self) -> bool {
        Kind::ALL
            .into_iter()
            .filter(|kind| kind.silences_output())
            .any(|kind| self.release_at[kind.index()].is_some())
    }

    fn release_due(&mut self, now: Instant) {
        for kind in Kind::ALL {
            if self.release_at[kind.index()].is_some_and(|at| at <= now) {
                self.release_at[kind.index()] = None;
                let held = self.held[kind.index()].take();
                contained("restoring the environment", move || drop(held));
            }
            if kind == Kind::Duck && !self.output_pending_release() {
                for then in std::mem::take(&mut self.waiting) {
                    contained("an end callback", then);
                }
            }
        }
    }

    fn release_all(&mut self) {
        let now = Instant::now();
        for kind in Kind::ALL {
            if self.held[kind.index()].is_some() {
                self.release_at[kind.index()] = Some(now);
            }
        }
        self.release_due(now);
    }
}

/// A backend or callback that panics must not take the worker down, and
/// with it every later dictation's changes and restores.
fn contained<T>(what: &str, work: impl FnOnce() -> T) -> Option<T> {
    std::panic::catch_unwind(AssertUnwindSafe(work))
        .inspect_err(|_| tracing::error!(what, "the recording environment panicked"))
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, PartialEq)]
    enum Event {
        Held(Effect),
        Restored(Kind),
        Then,
    }

    struct Observed(Kind, Sender<Event>);

    impl Drop for Observed {
        fn drop(&mut self) {
            let _ = self.1.send(Event::Restored(self.0));
        }
    }

    struct Observer {
        events: Sender<Event>,
        panics_on: Option<Effect>,
    }

    impl Environment for Observer {
        type Held = Observed;

        fn hold(&mut self, effect: Effect) -> Observed {
            if self.panics_on == Some(effect) {
                self.panics_on = None;
                panic!("a backend bug");
            }
            let _ = self.events.send(Event::Held(effect));
            Observed(effect.kind(), self.events.clone())
        }
    }

    struct Harness {
        commands: Sender<Command>,
        events: Receiver<Event>,
        events_sender: Sender<Event>,
        next: u64,
    }

    impl Harness {
        fn new(grace: Duration) -> Self {
            Self::panicking_once_on(grace, None)
        }

        fn panicking_once_on(grace: Duration, panics_on: Option<Effect>) -> Self {
            let (events_sender, events) = mpsc::channel();
            let observer = Observer {
                events: events_sender.clone(),
                panics_on,
            };
            Self {
                commands: spawn(grace, move || observer).unwrap(),
                events,
                events_sender,
                next: 0,
            }
        }

        fn begin(&mut self, effects: &[Effect]) -> u64 {
            self.begin_after(effects, Duration::ZERO)
        }

        fn begin_after(&mut self, effects: &[Effect], delay: Duration) -> u64 {
            self.next += 1;
            self.commands
                .send(Command::Begin {
                    session: self.next,
                    effects: effects.to_vec(),
                    delay,
                })
                .unwrap();
            self.next
        }

        fn end(&self, session: u64) {
            self.commands
                .send(Command::End {
                    session,
                    then: None,
                })
                .unwrap();
        }

        fn end_then(&self, session: u64) {
            let events = self.events_sender.clone();
            self.commands
                .send(Command::End {
                    session,
                    then: Some(Box::new(move || events.send(Event::Then).unwrap())),
                })
                .unwrap();
        }

        /// What the worker did since the last call, once it handled every
        /// command sent before it.
        fn settled(&self) -> Vec<Event> {
            let (reply, done) = mpsc::channel();
            self.commands.send(Command::Barrier(reply)).unwrap();
            done.recv_timeout(Duration::from_secs(5)).unwrap();
            self.events.try_iter().collect()
        }

        fn shutdown(&self) -> Vec<Event> {
            let (done, finished) = mpsc::channel();
            self.commands.send(Command::Shutdown(done)).unwrap();
            finished.recv_timeout(Duration::from_secs(5)).unwrap();
            self.events.try_iter().collect()
        }
    }

    use Event::{Held, Restored, Then};

    const DUCK: Effect = Effect::Duck { volume: 0.2 };

    #[test]
    fn an_overlapping_session_never_captures_the_lowered_output_as_original() {
        let mut environment = Harness::new(Duration::ZERO);
        let first = environment.begin(&[DUCK, Effect::Sleep]);
        let second = environment.begin(&[Effect::Duck { volume: 0.5 }, Effect::Sleep]);
        assert_eq!(environment.settled(), [Held(DUCK), Held(Effect::Sleep)]);

        environment.end(first);
        assert_eq!(environment.settled(), []);

        environment.end(second);
        assert_eq!(
            environment.settled(),
            [Restored(Kind::Duck), Restored(Kind::Sleep)]
        );
    }

    #[test]
    fn back_to_back_sessions_keep_the_output_quiet_through_the_grace_period() {
        let mut environment = Harness::new(Duration::from_secs(60));
        let first = environment.begin(&[Effect::Mute]);
        environment.end(first);
        let second = environment.begin(&[Effect::Mute]);
        environment.end(second);
        assert_eq!(environment.settled(), [Held(Effect::Mute)]);
        assert_eq!(environment.shutdown(), [Restored(Kind::Mute)]);
    }

    /// The start sound holds each capture's change back for longer than the
    /// grace lasts, which let a queue's output come back between captures.
    #[test]
    fn a_capture_starting_while_the_output_is_still_quiet_takes_it_over_without_its_delay() {
        let grace = Duration::from_millis(100);
        let delay = Duration::from_millis(200);
        let mut environment = Harness::new(grace);
        let first = environment.begin_after(&[Effect::Mute], delay);
        assert_eq!(environment.settled(), []);
        std::thread::sleep(delay * 2);
        assert_eq!(environment.settled(), [Held(Effect::Mute)]);

        environment.end(first);
        let second = environment.begin_after(&[Effect::Mute], delay);
        std::thread::sleep((grace + delay) * 2);
        assert_eq!(environment.settled(), []);

        environment.end(second);
        assert_eq!(environment.shutdown(), [Restored(Kind::Mute)]);
    }

    #[test]
    fn different_settings_compose_and_each_change_is_restored_by_its_last_session() {
        let mut environment = Harness::new(Duration::ZERO);
        let pausing = environment.begin(&[Effect::Pause { browsers: false }]);
        let muting = environment.begin(&[Effect::Mute, Effect::Sleep]);
        environment.end(muting);
        assert_eq!(
            environment.settled(),
            [
                Held(Effect::Pause { browsers: false }),
                Held(Effect::Mute),
                Held(Effect::Sleep),
                Restored(Kind::Mute),
                Restored(Kind::Sleep),
            ]
        );
        environment.end(pausing);
        assert_eq!(environment.settled(), [Restored(Kind::Pause)]);
    }

    #[test]
    fn an_end_callback_runs_once_the_output_is_audible_and_before_media_resumes() {
        let mut environment = Harness::new(Duration::ZERO);
        let session = environment.begin(&[Effect::Mute]);
        environment.settled();
        environment.end_then(session);
        assert_eq!(environment.settled(), [Restored(Kind::Mute), Then]);

        let session = environment.begin(&[Effect::Pause { browsers: true }]);
        environment.settled();
        environment.end_then(session);
        assert_eq!(environment.settled(), [Then, Restored(Kind::Pause)]);
    }

    #[test]
    fn shutting_down_restores_sessions_that_are_still_alive_and_later_ends_are_harmless() {
        let mut environment = Harness::new(Duration::ZERO);
        let session = environment.begin(&[DUCK, Effect::Sleep]);
        assert_eq!(
            environment.shutdown(),
            [
                Held(DUCK),
                Held(Effect::Sleep),
                Restored(Kind::Duck),
                Restored(Kind::Sleep)
            ]
        );
        environment.end(session);
        let next = environment.begin(&[DUCK]);
        assert_eq!(environment.settled(), [Held(DUCK)]);
        environment.end(next);
        assert_eq!(environment.settled(), [Restored(Kind::Duck)]);
    }

    #[test]
    fn a_backend_that_panics_leaves_the_worker_serving_later_sessions() {
        let mut environment = Harness::panicking_once_on(Duration::ZERO, Some(Effect::Mute));
        let session = environment.begin(&[Effect::Mute, Effect::Sleep]);
        assert_eq!(environment.settled(), [Held(Effect::Sleep)]);
        environment.end(session);
        assert_eq!(environment.settled(), [Restored(Kind::Sleep)]);

        let session = environment.begin(&[Effect::Mute]);
        environment.end(session);
        assert_eq!(
            environment.settled(),
            [Held(Effect::Mute), Restored(Kind::Mute)]
        );
    }
}
