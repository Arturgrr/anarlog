//! Capture's files, without touching the screen: what a capture is called
//! and where it goes ([`names`], [`layout`]), the index of recent captures
//! ([`index`]) and the macOS screenshot shortcuts it can switch off and back
//! on ([`hotkeys`]). The `tauri-plugin-capture` plugin drives the native
//! layer and uses these.

pub mod fs;
pub mod hotkeys;
pub mod index;
pub mod layout;
pub mod names;
pub mod shortcuts;

pub use index::{Entry, Index, Kind};
pub use layout::Layout;
pub use names::{ImageFormat, Stamp};
