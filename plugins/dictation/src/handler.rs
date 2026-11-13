use crate::{error::Error, events::HudEvent};

#[cfg(target_os = "macos")]
pub use self::macos::Handler;

#[cfg(not(target_os = "macos"))]
pub use self::webview::Handler;

/// The HUD on macOS: a native panel drawing the scope with Metal
/// (`dictation-ui-macos`), prewarmed so the first press never waits on it.
#[cfg(target_os = "macos")]
mod macos {
    use anlg_dictation_ui_macos as ui;

    use super::{Error, HudEvent};

    pub struct Handler;

    impl Handler {
        pub fn new(_app: tauri::AppHandle) -> Self {
            ui::prewarm_hud();
            Self
        }

        pub async fn hud(&self, event: HudEvent) -> Result<(), Error> {
            let json = serde_json::to_string(&event).map_err(|e| Error::Hud(e.to_string()))?;
            if ui::hud_event(&json) {
                Ok(())
            } else {
                Err(Error::Hud("the dictation indicator could not show".into()))
            }
        }

        pub fn meter(&self, rms: f32) {
            ui::hud_meter(rms);
        }
    }
}

/// The HUD on Windows and Linux: a transparent, click-through, never-focused
/// webview at the top or bottom of the display under the pointer, or none at
/// all when hidden, drawing the scope with WebGL
/// (`apps/desktop/src/dictation/hud`). The page keeps the HUD's clock and
/// says when it has faded out, so the window hides. Type-checked in macOS
/// tests too.
#[cfg(any(test, not(target_os = "macos")))]
#[cfg_attr(target_os = "macos", allow(dead_code))]
mod webview {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::time::Duration;

    use serde::{Deserialize, Serialize};
    use tauri::{Emitter, Listener, Manager};

    use super::{Error, HudEvent};
    use crate::events::HudPosition;

    pub const LABEL: &str = "dictation-overlay";
    const URL: &str = "dictation-hud.html";
    /// Hex's HUD window off macOS (304 × 80 pt) with room below it for the
    /// live text plate (`hud/page.ts` lays both out).
    const WINDOW: (f64, f64) = (560.0, 100.0);
    /// The window's margin from the top of the work area, as Hex's.
    const TOP_OFFSET: f64 = 12.0;
    /// The window's margin from the bottom of the work area: clear of the
    /// taskbar or a dock, as Hex's bottom position on macOS.
    const BOTTOM_OFFSET: f64 = 24.0;
    /// How often a shown HUD moves to the display under the pointer.
    const FOLLOW_EVERY: Duration = Duration::from_millis(250);
    /// How long a new HUD page has to load before dictation gives up.
    const READY_TIMEOUT: Duration = Duration::from_secs(5);

    const EVENT: &str = "dictation-hud:event";
    const METER: &str = "dictation-hud:meter";
    const READY: &str = "dictation-hud:ready";
    const SETTLED: &str = "dictation-hud:settled";

    #[derive(Clone, Serialize)]
    struct Message {
        session: u32,
        event: HudEvent,
    }

    #[derive(Deserialize)]
    struct Settled {
        session: u32,
    }

    struct Shared {
        app: tauri::AppHandle,
        ready: AtomicBool,
        loaded: tokio::sync::Notify,
        shown: AtomicBool,
        session: AtomicU32,
        monitor: std::sync::Mutex<Option<(i32, i32)>>,
        position: std::sync::Mutex<HudPosition>,
    }

    pub struct Handler {
        shared: Arc<Shared>,
    }

    impl Handler {
        pub fn new(app: tauri::AppHandle) -> Self {
            let shared = Arc::new(Shared {
                app: app.clone(),
                ready: AtomicBool::new(false),
                loaded: tokio::sync::Notify::new(),
                shown: AtomicBool::new(false),
                session: AtomicU32::new(0),
                monitor: std::sync::Mutex::new(None),
                position: std::sync::Mutex::new(HudPosition::Top),
            });
            let on_ready = shared.clone();
            app.listen_any(READY, move |_| {
                on_ready.ready.store(true, Ordering::SeqCst);
                on_ready.loaded.notify_waiters();
            });
            let on_settled = shared.clone();
            app.listen_any(SETTLED, move |event| {
                let Ok(settled) = serde_json::from_str::<Settled>(event.payload()) else {
                    return;
                };
                if settled.session == on_settled.session.load(Ordering::SeqCst) {
                    on_settled.hide();
                }
            });
            Self { shared }
        }

        pub async fn hud(&self, event: HudEvent) -> Result<(), Error> {
            let shared = &self.shared;
            if let HudEvent::Started { position } = event {
                return shared.start(position).await;
            }
            if shared.shown.load(Ordering::SeqCst) {
                shared.send(event);
            }
            Ok(())
        }

        pub fn meter(&self, rms: f32) {
            if self.shared.shown.load(Ordering::SeqCst) {
                let _ = self.shared.app.emit_to(LABEL, METER, rms);
            }
        }
    }

    impl Shared {
        fn send(&self, event: HudEvent) {
            let session = self.session.load(Ordering::SeqCst);
            let _ = self.app.emit_to(LABEL, EVENT, Message { session, event });
        }

        async fn start(self: &Arc<Self>, position: HudPosition) -> Result<(), Error> {
            if position == HudPosition::Hidden {
                // Nothing to show, so nothing that can fail: the window is
                // neither created nor shown, an earlier dictation's HUD goes,
                // and the rest of this dictation's events find it hidden.
                self.session.fetch_add(1, Ordering::SeqCst);
                self.hide();
                return Ok(());
            }
            *self
                .position
                .lock()
                .unwrap_or_else(|error| error.into_inner()) = position;
            let loaded = self.loaded.notified();
            tokio::pin!(loaded);
            loaded.as_mut().enable();
            let app = self.app.clone();
            on_main(&self.app, move || ensure_window(&app))?;
            if !self.ready.load(Ordering::SeqCst) {
                tokio::time::timeout(READY_TIMEOUT, loaded)
                    .await
                    .map_err(|_| Error::Hud("the dictation indicator did not load".into()))?;
            }
            self.session.fetch_add(1, Ordering::SeqCst);
            self.send(HudEvent::Started { position });
            let this = self.clone();
            on_main(&self.app, move || this.place(true))?;
            if !self.shown.swap(true, Ordering::SeqCst) {
                let this = self.clone();
                tauri::async_runtime::spawn(async move { this.follow_pointer().await });
            }
            Ok(())
        }

        /// While shown, moves the HUD to the display under the pointer when
        /// the pointer moved to another, as Hex does every 250 ms.
        async fn follow_pointer(self: Arc<Self>) {
            while self.shown.load(Ordering::SeqCst) {
                tokio::time::sleep(FOLLOW_EVERY).await;
                if !self.shown.load(Ordering::SeqCst) {
                    break;
                }
                let this = self.clone();
                let _ = on_main(&self.app, move || this.place(false));
            }
        }

        /// Top- or bottom-centre of the work area of the display under the
        /// pointer; `show` also orders the window in.
        fn place(&self, show: bool) -> Result<(), Error> {
            let Some(window) = self.app.get_webview_window(LABEL) else {
                return Ok(());
            };
            let monitor = self
                .app
                .cursor_position()
                .ok()
                .and_then(|cursor| {
                    self.app
                        .monitor_from_point(cursor.x, cursor.y)
                        .ok()
                        .flatten()
                })
                .or_else(|| self.app.primary_monitor().ok().flatten());
            if let Some(monitor) = monitor {
                let key = (monitor.position().x, monitor.position().y);
                let mut placed = self
                    .monitor
                    .lock()
                    .unwrap_or_else(|error| error.into_inner());
                if show || *placed != Some(key) {
                    let scale = monitor.scale_factor();
                    let work = monitor.work_area();
                    let origin = work.position.to_logical::<f64>(scale);
                    let size = work.size.to_logical::<f64>(scale);
                    let position = *self
                        .position
                        .lock()
                        .unwrap_or_else(|error| error.into_inner());
                    let (x, y) =
                        window_origin((origin.x, origin.y), (size.width, size.height), position);
                    window.set_position(tauri::LogicalPosition::new(x, y))?;
                    *placed = Some(key);
                }
            }
            if show {
                window.show()?;
                window.set_ignore_cursor_events(true)?;
            }
            Ok(())
        }

        fn hide(&self) {
            if !self.shown.swap(false, Ordering::SeqCst) {
                return;
            }
            *self
                .monitor
                .lock()
                .unwrap_or_else(|error| error.into_inner()) = None;
            let app = self.app.clone();
            let _ = self.app.run_on_main_thread(move || {
                if let Some(window) = app.get_webview_window(LABEL) {
                    let _ = window.hide();
                }
            });
        }
    }

    /// The window's top-left corner in a work area (logical, y down): centred,
    /// at the top or above the bottom. A notch is macOS's; here it is the top.
    pub(super) fn window_origin(
        origin: (f64, f64),
        size: (f64, f64),
        position: HudPosition,
    ) -> (f64, f64) {
        let x = origin.0 + (size.0 - WINDOW.0) / 2.0;
        let y = match position {
            HudPosition::Bottom => origin.1 + size.1 - WINDOW.1 - BOTTOM_OFFSET,
            HudPosition::Top | HudPosition::Hidden | HudPosition::Notch => origin.1 + TOP_OFFSET,
        };
        (x, y)
    }

    fn ensure_window(app: &tauri::AppHandle) -> Result<(), Error> {
        if app.get_webview_window(LABEL).is_some() {
            return Ok(());
        }
        let window =
            tauri::WebviewWindowBuilder::new(app, LABEL, tauri::WebviewUrl::App(URL.into()))
                .title("Dictation")
                .inner_size(WINDOW.0, WINDOW.1)
                .decorations(false)
                .shadow(false)
                .background_color(tauri::window::Color(0, 0, 0, 0))
                .focused(false)
                .focusable(false)
                .visible(false)
                .always_on_top(true)
                .visible_on_all_workspaces(true)
                .skip_taskbar(true)
                .content_protected(true)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .closable(false)
                .disable_drag_drop_handler();
        #[cfg(not(target_os = "macos"))]
        let window = window.transparent(true);
        let window = window.build()?;
        window.set_ignore_cursor_events(true)?;
        Ok(())
    }

    /// Runs `work` on the main thread, where windowing calls belong (GTK on
    /// Linux), and returns its result.
    fn on_main<T: Send + 'static>(
        app: &tauri::AppHandle,
        work: impl FnOnce() -> Result<T, Error> + Send + 'static,
    ) -> Result<T, Error> {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            let _ = tx.send(work());
        })?;
        rx.recv()
            .map_err(|_| Error::Hud("main thread reply lost".into()))?
    }
}

#[cfg(test)]
mod tests {
    use super::webview::window_origin;
    use crate::events::HudPosition;

    /// A 1920 × 1080 display right of the primary one, its taskbar 48 px
    /// tall at the bottom: Bottom must clear the taskbar, not cover it.
    #[test]
    fn the_web_hud_sits_at_the_top_or_above_the_taskbar() {
        let origin = (1920.0, 0.0);
        let size = (1920.0, 1032.0);
        assert_eq!(
            window_origin(origin, size, HudPosition::Top),
            (1920.0 + 680.0, 12.0)
        );
        assert_eq!(
            window_origin(origin, size, HudPosition::Notch),
            window_origin(origin, size, HudPosition::Top)
        );
        assert_eq!(
            window_origin(origin, size, HudPosition::Bottom),
            (1920.0 + 680.0, 1032.0 - 100.0 - 24.0)
        );
    }
}
