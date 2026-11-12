/// What went wrong, for the app to explain in its own words; `message` is
/// the English detail for logs and unknown kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum LlmErrorKind {
    /// This build or platform has no built-in model server.
    Unavailable,
    /// An administrator turned intelligence off.
    IntelligenceDisabled,
    NotDownloaded,
    /// The model needs more memory than this computer allows for it.
    TooLarge,
    /// A small-memory Mac is recording or transcribing a recording;
    /// transcription needs the room.
    CaptureActive,
    StartFailed,
    /// The server failed to start three times in a row.
    GaveUp,
    DiskSpace,
    Download,
    Other,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct LlmError {
    pub kind: LlmErrorKind,
    pub message: String,
}

impl LlmError {
    pub fn new(kind: LlmErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn other(message: impl std::fmt::Display) -> Self {
        Self::new(LlmErrorKind::Other, message.to_string())
    }
}

impl From<anlg_model_downloader::Error> for LlmError {
    fn from(error: anlg_model_downloader::Error) -> Self {
        let kind = match error {
            anlg_model_downloader::Error::InsufficientDiskSpace { .. } => LlmErrorKind::DiskSpace,
            anlg_model_downloader::Error::ModelNotDownloaded(_) => LlmErrorKind::NotDownloaded,
            _ => LlmErrorKind::Download,
        };
        Self::new(kind, error.to_string())
    }
}

impl From<anlg_local_llm::ServerError> for LlmError {
    fn from(error: anlg_local_llm::ServerError) -> Self {
        let kind = match error {
            anlg_local_llm::ServerError::StartFailed(_) => LlmErrorKind::StartFailed,
            anlg_local_llm::ServerError::GaveUp(_) => LlmErrorKind::GaveUp,
        };
        Self::new(kind, error.to_string())
    }
}
