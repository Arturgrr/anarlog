use serde::{Serialize, ser::Serializer};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    AnlgFileError(#[from] anlg_file::Error),
    #[error(transparent)]
    ModelDownloaderError(#[from] anlg_model_downloader::Error),
    #[error("Model not downloaded")]
    ModelNotDownloaded,
    #[error("Server start failed {0}")]
    ServerStartFailed(String),
    #[error("Server stop failed {0}")]
    ServerStopFailed(String),
    #[error("Supervisor not found")]
    SupervisorNotFound,
    #[error("Internal server only supports GGUF and whisper.cpp models")]
    UnsupportedModelType,
    #[error("This on-device transcription model is not available on this platform")]
    UnsupportedPlatform,
    #[error("Invalid local transcription model: {0}")]
    InvalidModelPath(String),
    #[error("Could not load the transcription model: {0}")]
    ModelLoadFailed(String),
    #[error("Model delete failed: {0}")]
    ModelDeleteFailed(String),
    #[error("Model unpack failed: {0}")]
    ModelUnpackFailed(String),
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
