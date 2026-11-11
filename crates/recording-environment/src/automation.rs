//! Which media players macOS lets this app script ("Automation" consent).
//! A dictation only looks: asking opens a prompt that holds the script, and
//! the worker with it, until it is answered, and can take the keyboard from
//! the app being dictated into. Settings asks instead.

use crate::MediaControl;

pub(crate) trait Automation {
    type Player: Copy + PartialEq + std::fmt::Debug;
    /// The known players that are running.
    fn running(&mut self) -> Vec<Self::Player>;
    /// Consent to script `player`, which runs; prompts only with `ask`.
    fn consent(&mut self, player: Self::Player, ask: bool) -> MediaControl;
}

/// The running players this app may already script, checked without asking.
pub(crate) fn allowed<A: Automation>(automation: &mut A) -> Vec<A::Player> {
    let running = automation.running();
    running
        .into_iter()
        .filter(|&player| match automation.consent(player, false) {
            MediaControl::Allowed => true,
            control => {
                tracing::info!(
                    ?player,
                    ?control,
                    "left a media player alone: Automation is not allowed"
                );
                false
            }
        })
        .collect()
}

/// Asks for each of `players` that runs, prompting where macOS has not asked
/// yet, and says where each stands.
pub(crate) fn request<A: Automation>(
    automation: &mut A,
    players: &[A::Player],
) -> Vec<(A::Player, MediaControl)> {
    let running = automation.running();
    players
        .iter()
        .map(|&player| {
            let control = if running.contains(&player) {
                automation.consent(player, true)
            } else {
                MediaControl::NotRunning
            };
            (player, control)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    use MediaControl::{Allowed, Denied, NotDetermined, NotRunning};

    struct Fake {
        running: Vec<usize>,
        consent: [MediaControl; 4],
        asked: Vec<(usize, bool)>,
    }

    impl Automation for Fake {
        type Player = usize;

        fn running(&mut self) -> Vec<usize> {
            self.running.clone()
        }

        fn consent(&mut self, player: usize, ask: bool) -> MediaControl {
            self.asked.push((player, ask));
            self.consent[player]
        }
    }

    /// The first dictation to pause a player opened the consent prompt and
    /// held the worker until it was answered.
    #[test]
    fn a_dictation_scripts_only_players_already_allowed_and_only_settings_asks() {
        let mut players = Fake {
            running: vec![0, 1, 2],
            consent: [Allowed, NotDetermined, Denied, Allowed],
            asked: Vec::new(),
        };
        assert_eq!(allowed(&mut players), [0]);
        assert!(players.asked.iter().all(|&(_, ask)| !ask));

        players.asked.clear();
        assert_eq!(
            request(&mut players, &[0, 1, 2, 3]),
            [
                (0, Allowed),
                (1, NotDetermined),
                (2, Denied),
                (3, NotRunning)
            ]
        );
        assert_eq!(players.asked, [(0, true), (1, true), (2, true)]);
    }
}
