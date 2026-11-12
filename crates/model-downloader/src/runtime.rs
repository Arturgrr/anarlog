use std::path::{Path, PathBuf};

use crate::model::DownloadableModel;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum DownloadStatus {
    Downloading(u8),
    Completed,
    Failed(String),
}

pub trait ModelDownloaderRuntime<M: DownloadableModel>: Send + Sync + 'static {
    fn models_base(&self) -> Result<PathBuf, crate::Error>;
    fn emit_progress(&self, model: &M, status: DownloadStatus);

    /// Free bytes on the volume that will hold `path`; `None` when unknown,
    /// which skips the disk-space check.
    fn available_space(&self, path: &Path) -> Option<u64> {
        crate::download_paths::available_space(path)
    }
}
