use serde::Deserialize;
use serde_json::Value;

/// The error codes the Swift side returns. Hosts match on these; the
/// message is for logs.
pub mod codes {
    /// Not macOS: every call on another system returns this.
    pub const UNSUPPORTED: &str = "unsupported";
    /// A blocking call came from the main thread, which it would stall.
    pub const MAIN_THREAD: &str = "main_thread";
    /// A recording is already starting, recording or finishing.
    pub const BUSY: &str = "busy";
    pub const NOT_RECORDING: &str = "not_recording";
    /// Screen Recording is not granted to this process.
    pub const PERMISSION: &str = "permission";
    pub const NO_DISPLAY: &str = "no_display";
    pub const INVALID_ARGUMENT: &str = "invalid_argument";
    /// A file or directory could not be created, written or removed.
    pub const IO: &str = "io";
    /// ScreenCaptureKit refused or stopped the stream.
    pub const STREAM: &str = "stream";
    /// The recording output failed and left no usable movie.
    pub const RECORDING: &str = "recording";
    pub const TIMEOUT: &str = "timeout";
    /// No frame could be read from the movie.
    pub const EXTRACT: &str = "extract";
    /// A reply that could not be read, or a state that should not happen.
    pub const INTERNAL: &str = "internal";
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AnnotateError {
    pub code: String,
    pub message: String,
}

impl AnnotateError {
    pub(crate) fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for AnnotateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AnnotateError {}

#[derive(Deserialize)]
struct Envelope {
    ok: bool,
    #[serde(default)]
    value: Value,
    #[serde(default)]
    error: Option<WireError>,
}

#[derive(Deserialize)]
struct WireError {
    code: String,
    #[serde(default)]
    message: String,
}

/// Reads the `{"ok": true, "value": …}` / `{"ok": false, "error": {…}}`
/// envelope every Swift entry point returns.
pub(crate) fn parse(raw: &str) -> Result<Value, AnnotateError> {
    let envelope: Envelope = serde_json::from_str(raw).map_err(|error| {
        AnnotateError::new(
            codes::INTERNAL,
            format!("unreadable reply ({error}): {raw}"),
        )
    })?;
    if envelope.ok {
        return Ok(envelope.value);
    }
    Err(match envelope.error {
        Some(error) => AnnotateError {
            code: error.code,
            message: error.message,
        },
        None => AnnotateError::new(codes::INTERNAL, "failed without an error"),
    })
}

pub(crate) fn expect_bool(value: Value) -> Result<bool, AnnotateError> {
    value
        .as_bool()
        .ok_or_else(|| AnnotateError::new(codes::INTERNAL, format!("expected a bool: {value}")))
}

pub(crate) fn expect_string(value: Value) -> Result<String, AnnotateError> {
    match value {
        Value::String(text) => Ok(text),
        other => Err(AnnotateError::new(
            codes::INTERNAL,
            format!("expected a string: {other}"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reply_swift_could_not_produce_becomes_an_error_never_a_panic() {
        assert_eq!(
            parse(r#"{"ok":true,"value":{"phase":"idle"}}"#).unwrap(),
            serde_json::json!({ "phase": "idle" })
        );
        assert_eq!(parse(r#"{"ok":true}"#).unwrap(), Value::Null);
        assert_eq!(
            parse(r#"{"ok":false,"error":{"code":"busy","message":"recording"}}"#),
            Err(AnnotateError::new(codes::BUSY, "recording"))
        );
        for raw in ["", "not json", r#"{"ok":false}"#, r#"{"value":1}"#] {
            assert_eq!(parse(raw).unwrap_err().code, codes::INTERNAL, "{raw}");
        }
    }
}
