use ashpd::desktop::global_shortcuts::{GlobalShortcuts, NewShortcut};
use futures_util::StreamExt;
use tauri::Manager;
use tauri_plugin_global_shortcut::Shortcut;

use super::trigger::portal_trigger;

use crate::{ShortcutEvent, press};

pub struct Registration {
    stop: tokio::sync::oneshot::Sender<()>,
    task: tauri::async_runtime::JoinHandle<()>,
}

impl Registration {
    pub async fn close(self) {
        let _ = self.stop.send(());
        let _ = self.task.await;
    }
}

/// Binds every shortcut in one portal session; each is paired with its
/// position in the configured list.
pub async fn register(
    app: tauri::AppHandle,
    keys: Vec<(usize, Shortcut)>,
) -> Result<Registration, String> {
    let portal = GlobalShortcuts::new().await.map_err(|e| {
        format!("This Wayland desktop does not provide the Global Shortcuts portal: {e}")
    })?;
    let session = portal
        .create_session(Default::default())
        .await
        .map_err(|e| e.to_string())?;
    let setup = tokio::time::timeout(std::time::Duration::from_secs(45), async {
        let pressed = portal
            .receive_activated()
            .await
            .map_err(|e| e.to_string())?;
        let released = portal
            .receive_deactivated()
            .await
            .map_err(|e| e.to_string())?;
        let mut shortcuts = Vec::new();
        for (position, (source, key)) in keys.iter().enumerate() {
            let description = if position == 0 {
                "Dictate with Librelog".to_string()
            } else {
                format!("Dictate with Librelog ({})", position + 1)
            };
            shortcuts.push(
                NewShortcut::new(format!("dictate-{source}"), description)
                    .preferred_trigger(portal_trigger(*key)?.as_str()),
            );
        }
        shortcuts.push(
            NewShortcut::new("cancel-dictation", "Cancel Librelog dictation")
                .preferred_trigger("CTRL+ALT+Escape"),
        );
        portal
            .bind_shortcuts(&session, &shortcuts, None, Default::default())
            .await
            .and_then(|request| request.response())
            .map_err(|e| e.to_string())?;
        Ok::<_, String>((pressed, released))
    })
    .await;
    let (mut pressed, mut released) = match setup {
        Ok(Ok(streams)) => streams,
        error => {
            let _ = session.close().await;
            return Err(match error {
                Ok(Err(error)) => error,
                _ => "Shortcut setup timed out. Retry setup and approve your desktop's shortcut prompt.".into(),
            });
        }
    };
    let session_path: String =
        serde_json::from_value(serde_json::to_value(&session).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let (stop, mut stopped) = tokio::sync::oneshot::channel();

    let task = tauri::async_runtime::spawn(async move {
        let Ok(mut closed) = session.receive_closed().await else {
            let _ = session.close().await;
            press::cancel(&app);
            return;
        };
        let source_of = |id: &str| id.strip_prefix("dictate-")?.parse::<usize>().ok();
        loop {
            tokio::select! {
                _ = &mut stopped => break,
                _ = closed.next() => break,
                event = pressed.next() => {
                    let Some(event) = event else { break };
                    if event.session_handle().as_str() != session_path { continue; }
                    if let Some(source) = source_of(event.shortcut_id()) {
                        press::emit(&app, source, ShortcutEvent::Pressed);
                    } else if event.shortcut_id() == "cancel-dictation"
                        && app.state::<super::GlobalState>().active.load(std::sync::atomic::Ordering::SeqCst)
                    {
                        press::cancel(&app);
                    }
                }
                event = released.next() => {
                    let Some(event) = event else { break };
                    if event.session_handle().as_str() != session_path { continue; }
                    if let Some(source) = source_of(event.shortcut_id()) {
                        press::emit(&app, source, ShortcutEvent::Released);
                    }
                }
            }
        }
        let _ = session.close().await;
        press::cancel(&app);
    });
    Ok(Registration { stop, task })
}
