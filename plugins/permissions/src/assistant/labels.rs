use std::sync::RwLock;

// Overlay text in the app language, sent by the frontend once its locale loads.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantLabels {
    pub allow_accessibility: String,
    pub drag_hint: String,
    pub dismiss: String,
}

impl Default for AssistantLabels {
    fn default() -> Self {
        Self {
            allow_accessibility: "Allow Accessibility".into(),
            drag_hint: "Drag the app below into the list above.".into(),
            dismiss: "Dismiss".into(),
        }
    }
}

static LABELS: RwLock<Option<AssistantLabels>> = RwLock::new(None);

pub fn labels() -> AssistantLabels {
    LABELS
        .read()
        .ok()
        .and_then(|labels| labels.clone())
        .unwrap_or_default()
}

pub(crate) fn set_labels(labels: AssistantLabels) {
    if let Ok(mut current) = LABELS.write() {
        *current = Some(labels);
    }
}
