use crate::hotkey::Modifiers;

pub const KVK_ESCAPE: u16 = 0x35;
pub const KVK_FUNCTION: u16 = 0x3F;

/// A modifier key (by its `kVK_*` code) went down or up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModifierChange {
    Down(u16),
    Up(u16),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeyEvent {
    pub key: Option<u16>,
    pub modifiers: Modifiers,
    pub modifier_change: Option<ModifierChange>,
}

impl KeyEvent {
    pub const fn new(key: Option<u16>, modifiers: Modifiers) -> Self {
        Self {
            key,
            modifiers,
            modifier_change: None,
        }
    }

    pub const fn empty() -> Self {
        Self::new(None, Modifiers::empty())
    }

    pub const fn with_modifier_change(mut self, change: ModifierChange) -> Self {
        self.modifier_change = Some(change);
        self
    }

    pub fn is_escape(&self) -> bool {
        self.key == Some(KVK_ESCAPE)
    }
}
