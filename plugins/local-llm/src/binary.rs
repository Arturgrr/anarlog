use std::path::{Path, PathBuf};

use crate::UnavailableReason;

/// The bundled server's name. Not `librelog-sidecar-*`: debug builds pass
/// those through a legacy shim, and the app's exit sweep kills every
/// process whose name contains it.
pub const SERVER_NAME: &str = "librelog-llama-server";

/// Debug builds only: run this llama-server instead of the bundled one, on
/// any platform.
pub const SERVER_OVERRIDE_ENV: &str = "LIBRELOG_LLAMA_SERVER";

pub fn resolve() -> Result<PathBuf, UnavailableReason> {
    if cfg!(debug_assertions)
        && let Some(path) = std::env::var_os(SERVER_OVERRIDE_ENV).map(PathBuf::from)
        && path.is_file()
    {
        return Ok(path);
    }

    if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return Err(UnavailableReason::UnsupportedPlatform);
    }

    // Tauri puts external binaries next to the app's executable, without
    // the target triple.
    if let Some(path) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(SERVER_NAME)))
        .filter(|path| path.is_file())
    {
        return Ok(path);
    }

    if cfg!(debug_assertions) {
        let prepared = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop/src-tauri/binaries")
            .join(format!("{SERVER_NAME}-{}", env!("LOCAL_LLM_TARGET_TRIPLE")));
        if prepared.is_file() {
            return Ok(prepared);
        }
    }

    Err(UnavailableReason::MissingBinary)
}
