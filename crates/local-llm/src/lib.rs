//! Librelog's built-in language models: a catalog of GGUF chat models pinned
//! to their publishers' Hugging Face repositories, the memory policy that
//! decides whether and with how much context one loads, and the supervisor
//! for the bundled `llama-server` (llama.cpp) that serves the loaded model on
//! 127.0.0.1 behind a per-launch API key.

pub mod admission;
pub mod args;
mod catalog;
mod process;
mod server;

pub use admission::{Admission, Fit};
pub use catalog::{License, LlmArtifact, LlmModel, LlmModelInfo, UnknownLlmModel};
pub use process::{reap_stale_server, stop_process};
pub use server::{Endpoint, LaunchRequest, ServerConfig, ServerError, ServerManager, ServerState};
