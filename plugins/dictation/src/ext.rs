use crate::{error::Error, events::HudEvent, handler::Handler};

pub struct Dictation<'a, R: tauri::Runtime, M: tauri::Manager<R>> {
    manager: &'a M,
    _runtime: std::marker::PhantomData<fn() -> R>,
}

impl<'a, R: tauri::Runtime, M: tauri::Manager<R>> Dictation<'a, R, M> {
    /// Tells the HUD what the dictation is doing. `Started` resolves once the
    /// HUD is on screen, so a recording never starts unseen.
    pub async fn hud(&self, event: HudEvent) -> Result<(), Error> {
        self.manager.state::<Handler>().hud(event).await
    }

    /// The microphone's RMS for one captured buffer.
    pub fn meter(&self, rms: f32) {
        self.manager.state::<Handler>().meter(rms)
    }
}

pub trait DictationPluginExt<R: tauri::Runtime> {
    fn dictation(&self) -> Dictation<'_, R, Self>
    where
        Self: tauri::Manager<R> + Sized;
}

impl<R: tauri::Runtime, T: tauri::Manager<R>> DictationPluginExt<R> for T {
    fn dictation(&self) -> Dictation<'_, R, Self>
    where
        Self: Sized,
    {
        Dictation {
            manager: self,
            _runtime: std::marker::PhantomData,
        }
    }
}
