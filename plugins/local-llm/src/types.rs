use anlg_local_llm::{Admission, LlmModel, ServerState};
use anlg_model_downloader::DownloadStatus;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum UnavailableReason {
    /// Built-in models ship only in the macOS Apple silicon build outside
    /// the App Store.
    UnsupportedPlatform,
    /// The build has no llama-server next to the app.
    MissingBinary,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub available: bool,
    pub reason: Option<UnavailableReason>,
    pub total_memory_bytes: u64,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LlmModelLicense {
    pub name: String,
    pub url: String,
    pub attribution: String,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LlmModelEntry {
    pub id: LlmModel,
    pub display_name: String,
    pub size_bytes: u64,
    /// The context length the model declares.
    pub context_length: u32,
    pub license: LlmModelLicense,
    pub source_url: String,
    pub downloaded: bool,
    pub downloading: bool,
    /// Whether it fits this computer, and the context it would run with.
    pub admission: Admission,
    /// The model Settings recommends for this computer's memory.
    pub best: bool,
    /// The model onboarding offers.
    pub default: bool,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct LlmDownloadProgress {
    pub model: LlmModel,
    pub status: DownloadStatus,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct LlmServerStateChanged {
    pub state: ServerState,
}
