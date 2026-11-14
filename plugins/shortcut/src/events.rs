use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum Modifier {
    Command,
    RightCommand,
    Option,
    Shift,
    Control,
    Fn,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
pub struct HotKey {
    pub key: Option<u16>,
    pub modifiers: Vec<Modifier>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    #[serde(default)]
    pub use_double_tap_only: bool,
    #[serde(default = "default_true")]
    pub double_tap_lock_enabled: bool,
    #[serde(default = "default_min_key_time_ms")]
    pub minimum_key_time_ms: u64,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            use_double_tap_only: false,
            double_tap_lock_enabled: true,
            minimum_key_time_ms: default_min_key_time_ms(),
        }
    }
}

fn default_true() -> bool {
    true
}

fn default_min_key_time_ms() -> u64 {
    150
}

#[macro_export]
macro_rules! common_event_derives {
    ($item:item) => {
        #[derive(
            serde::Serialize, serde::Deserialize, Clone, specta::Type, tauri_specta::Event,
        )]
        $item
    };
}

common_event_derives! {
    #[serde(tag = "type", rename_all = "camelCase")]
    pub enum ShortcutEvent {
        Pressed,
        Released,
        Cancelled,
        Discarded,
    }
}

common_event_derives! {
    /// What the Annotate shortcut asks for, decided by its taps and holds.
    #[serde(tag = "type", rename_all = "camelCase")]
    pub enum AnnotateShortcutEvent {
        Start,
        Stop,
        /// Held while recording: ink follows the pointer until release.
        InkOn,
        InkOff,
        /// Escape while ink is on.
        Escape,
    }
}

common_event_derives! {
    /// Paste the last annotation: its shortcut was pressed.
    pub struct PasteLastAnnotationEvent {}
}

common_event_derives! {
    /// Paste the last dictation again: its shortcut was pressed, or its tray
    /// item chosen.
    pub struct PasteLastEvent {}
}

/// What a Capture shortcut, or its menu bar item, asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum CaptureAction {
    Area,
    Fullscreen,
    Window,
    Record,
    Gif,
}

impl CaptureAction {
    pub fn name(self) -> &'static str {
        match self {
            Self::Area => "capture area",
            Self::Fullscreen => "capture full screen",
            Self::Window => "capture window",
            Self::Record => "record video",
            Self::Gif => "record GIF",
        }
    }
}

common_event_derives! {
    /// A Capture shortcut was pressed, or its menu bar item chosen.
    pub struct CaptureShortcutEvent {
        pub action: CaptureAction,
    }
}

/// Capture's shortcuts; null or empty leaves one unbound.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct CaptureShortcuts {
    pub area: Option<String>,
    pub fullscreen: Option<String>,
    pub window: Option<String>,
    pub record: Option<String>,
    pub gif: Option<String>,
}
