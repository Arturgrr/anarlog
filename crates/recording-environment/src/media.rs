//! Pausing media players that report their playback state (MPRIS on Linux,
//! the system media transport controls on Windows), resuming only the ones
//! this session paused that are still paused.

pub(crate) trait Players {
    type Player;
    fn playing(&mut self) -> Vec<Self::Player>;
    fn pause(&mut self, player: &Self::Player) -> bool;
    fn paused(&mut self, player: &Self::Player) -> bool;
    fn play(&mut self, player: &Self::Player) -> bool;
}

/// Pauses every player that is playing, and returns those that paused.
pub(crate) fn pause_playing<P: Players>(players: &mut P) -> Vec<P::Player> {
    players
        .playing()
        .into_iter()
        .filter(|player| players.pause(player))
        .collect()
}

/// Plays each of `paused` that is still paused: one the user played,
/// stopped or closed meanwhile is left as it is.
pub(crate) fn resume<P: Players>(players: &mut P, paused: &[P::Player]) {
    for player in paused {
        if players.paused(player) && !players.play(player) {
            tracing::warn!("could not resume a player paused for dictation");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Copy, Debug, PartialEq)]
    enum State {
        Playing,
        Paused,
        Stopped,
    }

    struct Fake {
        states: Vec<State>,
        refuses_pause: usize,
    }

    impl Players for Fake {
        type Player = usize;

        fn playing(&mut self) -> Vec<usize> {
            (0..self.states.len())
                .filter(|&player| self.states[player] == State::Playing)
                .collect()
        }

        fn pause(&mut self, &player: &usize) -> bool {
            if player == self.refuses_pause {
                return false;
            }
            self.states[player] = State::Paused;
            true
        }

        fn paused(&mut self, &player: &usize) -> bool {
            self.states[player] == State::Paused
        }

        fn play(&mut self, &player: &usize) -> bool {
            self.states[player] = State::Playing;
            true
        }
    }

    #[test]
    fn only_players_this_session_paused_and_still_paused_are_resumed() {
        use State::{Paused, Playing, Stopped};
        let mut players = Fake {
            states: vec![Playing, Paused, Playing, Playing, Playing],
            refuses_pause: 4,
        };
        let paused = pause_playing(&mut players);
        assert_eq!(players.states, [Paused, Paused, Paused, Paused, Playing]);

        players.states[2] = Stopped;
        players.states[3] = Playing;
        players.states[4] = Paused;
        resume(&mut players, &paused);
        assert_eq!(players.states, [Playing, Paused, Stopped, Playing, Paused]);
    }
}
