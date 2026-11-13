use serde::{Serialize, ser::Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Annotate is only available in the macOS app.")]
    Unavailable,
    #[error("Screen Recording is not allowed for Librelog.")]
    Permission,
    #[error("An annotation is already {0}.")]
    Busy(&'static str),
    #[error("No annotation is recording.")]
    NotRecording,
    #[error("This annotation is no longer waiting to be finished.")]
    UnknownAnnotation,
    #[error("The annotation was cancelled.")]
    Cancelled,
    #[error("Could not record the microphone: {0}")]
    Microphone(String),
    #[error("Could not record the screen: {0}")]
    Native(String),
    #[error("Could not write the annotation: {0}")]
    Bundle(#[from] anlg_annotate_core::Error),
    #[error("Could not write the annotation: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Task(String),
}

impl From<anlg_annotate_macos::AnnotateError> for Error {
    fn from(error: anlg_annotate_macos::AnnotateError) -> Self {
        use anlg_annotate_macos::codes;
        match error.code.as_str() {
            codes::UNSUPPORTED => Self::Unavailable,
            codes::PERMISSION => Self::Permission,
            codes::BUSY => Self::Busy("recording"),
            codes::NOT_RECORDING => Self::NotRecording,
            _ => Self::Native(error.message),
        }
    }
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
