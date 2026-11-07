use crate::{
    error::Error,
    events::{HotKey, Options},
    handler::Handler,
};

pub struct Shortcut<'a, R: tauri::Runtime, M: tauri::Manager<R>> {
    manager: &'a M,
    _runtime: std::marker::PhantomData<fn() -> R>,
}

impl<'a, R: tauri::Runtime, M: tauri::Manager<R>> Shortcut<'a, R, M> {
    pub fn register(&self, hotkey: HotKey, options: Options) -> Result<(), Error> {
        let handler = self.manager.state::<Handler>();
        handler.register(self.manager.app_handle().clone(), hotkey, options)
    }

    #[cfg(target_os = "macos")]
    pub fn register_triggers(
        &self,
        triggers: Vec<(usize, anlg_shortcut_macos::Trigger)>,
        active: std::sync::Arc<std::sync::atomic::AtomicBool>,
    ) -> Result<(), Error> {
        let handler = self.manager.state::<Handler>();
        handler.register_triggers(self.manager.app_handle().clone(), triggers, active)
    }

    pub fn unregister(&self) -> Result<(), Error> {
        self.manager.state::<Handler>().unregister()
    }
}

pub trait ShortcutPluginExt<R: tauri::Runtime> {
    fn shortcut(&self) -> Shortcut<'_, R, Self>
    where
        Self: tauri::Manager<R> + Sized;
}

impl<R: tauri::Runtime, T: tauri::Manager<R>> ShortcutPluginExt<R> for T {
    fn shortcut(&self) -> Shortcut<'_, R, Self>
    where
        Self: Sized,
    {
        Shortcut {
            manager: self,
            _runtime: std::marker::PhantomData,
        }
    }
}
