use serde::{Serialize, ser::Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Capture is only available in the macOS app.")]
    Unavailable,
    #[error("Screen Recording is not allowed for Librelog.")]
    Permission,
    #[error("A capture is already running.")]
    Busy,
    #[error("No recording is running.")]
    NotRecording,
    #[error("This capture is no longer in the list.")]
    UnknownCapture,
    #[error("Only screenshots can be edited.")]
    NotAScreenshot,
    #[error("{0}")]
    Path(#[from] anlg_capture_core::layout::PathError),
    #[error("The destination must be an absolute file path.")]
    BadDestination,
    #[error("The edited picture is not a usable PNG: {0}")]
    BadImage(String),
    #[error("Replacing the macOS screenshot shortcuts is only available on macOS.")]
    ShortcutsUnavailable,
    #[error("Could not change the macOS screenshot shortcuts: {0}")]
    Shortcuts(String),
    #[error("Could not capture the screen: {0}")]
    Native(String),
    #[error("Librelog cannot save captures in {0}: {1}")]
    NotWritable(String, std::io::Error),
    #[error("The capture was kept at {0}, but {1}")]
    Kept(String, String),
    #[error("Could not write the capture: {0}")]
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
            codes::BUSY => Self::Busy,
            codes::NOT_RECORDING => Self::NotRecording,
            _ => Self::Native(error.message),
        }
    }
}

impl From<anlg_capture_core::hotkeys::Error> for Error {
    fn from(error: anlg_capture_core::hotkeys::Error) -> Self {
        Self::Shortcuts(error.to_string())
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
