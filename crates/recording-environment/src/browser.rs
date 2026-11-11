//! Pauses a browser that is audibly playing, and plays it again only when
//! the pause was seen to land, ported from Hex's browser media.
//!
//! macOS no longer tells other apps what is playing, and its pause and play
//! commands go to whatever it treats as Now Playing. So the browsers' own
//! output is heard instead: the level says whether the pause reached a
//! browser, and only that proof allows the play at the end.

use std::time::Duration;

/// Sound: a peak above this in every listen window.
const SOUND_DBFS: f32 = -60.0;
/// Silence: a peak below this in consecutive windows soon after the pause.
const SILENCE_DBFS: f32 = -90.0;
pub(crate) const WINDOW: Duration = Duration::from_millis(100);
const LISTEN_WINDOWS: usize = 3;
/// The silence must start in the first windows after the pause: a sound
/// that ends later on its own is not the pause reaching the browser.
const CONFIRM_WINDOWS: usize = 5;
const SILENT_WINDOWS: usize = 2;
/// The last listen before play.
const RESUME_LISTEN: Duration = Duration::from_millis(300);
/// After play, the browser must sound within this many windows. If it does
/// not, the play reached something else, which is paused again.
const PLAY_CHECK_WINDOWS: usize = 20;
/// A browser that closed its output opens it again within this many windows
/// of play. If none does, the play reached another app: pause it sooner.
const OPEN_CHECK_WINDOWS: usize = 10;

/// The explicit system commands. Never the toggle: it can start music.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MediaCommand {
    Play,
    Pause,
}

pub(crate) trait BrowserAudio {
    /// A browser uses the microphone: probably a call.
    fn in_call(&mut self) -> bool;
    /// Peak of the browsers' output over `window`, in dBFS; None when it
    /// cannot listen.
    fn peak_dbfs(&mut self, window: Duration) -> Option<f32>;
    fn send(&mut self, command: MediaCommand) -> bool;
    /// A browser runs and every one has closed its audio output.
    fn output_closed(&mut self) -> bool;
}

/// Proof that a sounding browser went silent right after the pause; only
/// this allows play.
#[derive(Debug)]
pub(crate) struct PausedBrowser(());

pub(crate) fn pause(audio: &mut impl BrowserAudio) -> Option<PausedBrowser> {
    if audio.in_call() {
        tracing::info!("left the browser alone: it is using the microphone");
        return None;
    }
    for _ in 0..LISTEN_WINDOWS {
        match audio.peak_dbfs(WINDOW) {
            Some(peak) if peak > SOUND_DBFS => {}
            Some(_) => return None,
            None => {
                tracing::info!("left the browser alone: cannot hear it");
                return None;
            }
        }
    }
    if !audio.send(MediaCommand::Pause) {
        tracing::info!("the system refused the pause command");
        return None;
    }
    let mut silent = 0;
    for _ in 0..CONFIRM_WINDOWS {
        if audio
            .peak_dbfs(WINDOW)
            .is_some_and(|peak| peak < SILENCE_DBFS)
        {
            silent += 1;
            if silent == SILENT_WINDOWS {
                tracing::info!("paused the browser");
                return Some(PausedBrowser(()));
            }
        } else {
            silent = 0;
        }
    }
    tracing::info!("sent pause but the browser still plays; it will not get play");
    None
}

pub(crate) fn resume(audio: &mut impl BrowserAudio, _paused: PausedBrowser) {
    let mut heard = true;
    match audio.peak_dbfs(RESUME_LISTEN) {
        Some(peak) if peak <= SOUND_DBFS => {}
        Some(_) => {
            tracing::info!("the browser already plays again; sent no play");
            return;
        }
        // A pause longer than about 10 s closes the browser's output, and a
        // tap on closed outputs delivers nothing: that browser is still paused.
        None if audio.output_closed() => heard = false,
        None => {
            tracing::info!("cannot hear the browser; sent no play");
            return;
        }
    }
    if !audio.send(MediaCommand::Play) {
        tracing::info!("the system refused the play command");
        return;
    }
    // The output delivers again once play opens it, about 300 ms later.
    for window in 1..=PLAY_CHECK_WINDOWS {
        match audio.peak_dbfs(WINDOW) {
            Some(peak) if peak > SOUND_DBFS => {
                tracing::info!("resumed the browser");
                return;
            }
            Some(_) => heard = true,
            None if !heard => {
                if window == OPEN_CHECK_WINDOWS && audio.output_closed() {
                    break;
                }
            }
            None => {
                tracing::info!("sent play but cannot hear the browser any more");
                return;
            }
        }
    }
    if !heard && !audio.output_closed() {
        tracing::info!("sent play but cannot hear the browser");
        return;
    }
    // A closed or reloaded tab stays silent, and the play went to whatever
    // macOS now treats as playing: pause that again.
    tracing::info!("the browser stayed silent after play; sent pause again");
    audio.send(MediaCommand::Pause);
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;

    use super::*;

    struct Fake {
        in_call: bool,
        peaks: VecDeque<Option<f32>>,
        sent: Vec<MediaCommand>,
        output_closed: bool,
    }

    impl Fake {
        fn new(peaks: impl IntoIterator<Item = Option<f32>>) -> Self {
            Self {
                in_call: false,
                peaks: peaks.into_iter().collect(),
                sent: Vec::new(),
                output_closed: false,
            }
        }
    }

    impl BrowserAudio for Fake {
        fn in_call(&mut self) -> bool {
            self.in_call
        }

        fn peak_dbfs(&mut self, _window: Duration) -> Option<f32> {
            self.peaks.pop_front().flatten()
        }

        fn send(&mut self, command: MediaCommand) -> bool {
            self.sent.push(command);
            true
        }

        fn output_closed(&mut self) -> bool {
            self.output_closed
        }
    }

    const PLAYING: [Option<f32>; LISTEN_WINDOWS] = [Some(-20.0); LISTEN_WINDOWS];

    #[test]
    fn a_confirmed_pause_is_resumed() {
        let mut audio = Fake::new(PLAYING.into_iter().chain([
            Some(-30.0),
            Some(-200.0),
            Some(-200.0),
            Some(-200.0),
            Some(-25.0),
        ]));
        let paused = pause(&mut audio).expect("the pause is confirmed");
        resume(&mut audio, paused);
        assert_eq!(audio.sent, [MediaCommand::Pause, MediaCommand::Play]);
    }

    #[test]
    fn a_pause_that_did_not_silence_the_browser_never_gets_play() {
        for after_pause in [
            vec![Some(-25.0); CONFIRM_WINDOWS],
            [vec![Some(-25.0); 4], vec![Some(-200.0); 6]].concat(),
        ] {
            let mut audio = Fake::new(PLAYING.into_iter().chain(after_pause));
            assert!(pause(&mut audio).is_none());
            assert_eq!(audio.sent, [MediaCommand::Pause]);
        }
    }

    #[test]
    fn a_browser_in_a_call_or_silent_or_unheard_is_left_alone() {
        let mut call = Fake::new(PLAYING);
        call.in_call = true;
        for mut audio in [call, Fake::new([Some(-120.0)]), Fake::new([None])] {
            assert!(pause(&mut audio).is_none());
            assert_eq!(audio.sent, []);
        }
    }

    #[test]
    fn a_play_the_browser_never_takes_is_paused_again() {
        let mut audio = Fake::new(std::iter::repeat_n(Some(-200.0), 40));
        resume(&mut audio, PausedBrowser(()));
        assert_eq!(audio.sent, [MediaCommand::Play, MediaCommand::Pause]);

        let mut played_by_hand = Fake::new([Some(-20.0)]);
        resume(&mut played_by_hand, PausedBrowser(()));
        assert_eq!(played_by_hand.sent, []);
    }
}
