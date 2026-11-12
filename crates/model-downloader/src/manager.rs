use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tokio::fs;

use crate::Error;
use crate::download_paths::part_path;
use crate::download_task::{DownloadTaskParams, spawn_download_task};
use crate::downloads_registry::{DownloadEntry, DownloadsRegistry};
use crate::model::DownloadableModel;
use crate::runtime::ModelDownloaderRuntime;
use crate::task_join::wait_for_task_exit;

pub struct ModelDownloadManager<M: DownloadableModel> {
    runtime: Arc<dyn ModelDownloaderRuntime<M>>,
    downloads: DownloadsRegistry,
    next_generation: Arc<AtomicU64>,
}

impl<M: DownloadableModel> Clone for ModelDownloadManager<M> {
    fn clone(&self) -> Self {
        Self {
            runtime: self.runtime.clone(),
            downloads: self.downloads.clone(),
            next_generation: self.next_generation.clone(),
        }
    }
}

impl<M: DownloadableModel> ModelDownloadManager<M> {
    const TASK_JOIN_WARN_AFTER: Duration = Duration::from_secs(5);
    /// Room left beyond the file itself, so a download never fills the disk.
    const DISK_MARGIN_BYTES: u64 = 1_000_000_000;

    pub fn new(runtime: Arc<dyn ModelDownloaderRuntime<M>>) -> Self {
        Self {
            runtime,
            downloads: DownloadsRegistry::new(),
            next_generation: Arc::new(AtomicU64::new(1)),
        }
    }

    pub fn model_path(&self, model: &M) -> Result<PathBuf, Error> {
        let models_base = self.runtime.models_base()?;
        Ok(model.download_destination(&models_base))
    }

    pub async fn is_downloaded(&self, model: &M) -> Result<bool, Error> {
        let models_base = self.runtime.models_base()?;
        let model_clone = model.clone();
        tokio::task::spawn_blocking(move || model_clone.is_downloaded(&models_base))
            .await
            .map_err(|e| Error::OperationFailed(e.to_string()))?
    }

    pub async fn is_downloading(&self, model: &M) -> bool {
        self.downloads.contains(&model.download_key()).await
    }

    pub async fn download(&self, model: &M) -> Result<(), Error> {
        let key = model.download_key();
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);

        let url = model
            .download_url()
            .ok_or_else(|| Error::NoDownloadUrl(model.download_key()))?;

        let models_base = self.runtime.models_base()?;
        let final_destination = model.download_destination(&models_base);
        let destination = part_path(&final_destination);
        self.check_disk_space(model, &destination).await?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).await?;
        }

        let (start_tx, start_rx) = tokio::sync::oneshot::channel::<()>();

        let cancellation_token = tokio_util::sync::CancellationToken::new();
        let task = spawn_download_task(
            DownloadTaskParams {
                runtime: self.runtime.clone(),
                registry: self.downloads.clone(),
                model: model.clone(),
                url,
                destination: destination.clone(),
                final_destination: final_destination.clone(),
                models_base: models_base.clone(),
                key: key.clone(),
                generation,
                cancellation_token: cancellation_token.clone(),
            },
            start_rx,
        );

        let existing = self
            .downloads
            .insert(
                key,
                DownloadEntry {
                    task,
                    token: cancellation_token,
                    generation,
                    download_path: destination,
                },
            )
            .await;

        if let Some(entry) = existing {
            entry.token.cancel();
            wait_for_task_exit(
                entry.task,
                Self::TASK_JOIN_WARN_AFTER,
                "replace_existing_download",
            )
            .await;
        }

        let _ = start_tx.send(());

        Ok(())
    }

    /// Refuses a download of known size that would leave less than
    /// `DISK_MARGIN_BYTES` free, counting what an earlier attempt already
    /// wrote.
    async fn check_disk_space(&self, model: &M, destination: &Path) -> Result<(), Error> {
        let Some(size) = model.download_size() else {
            return Ok(());
        };
        let written = fs::metadata(destination)
            .await
            .map(|meta| meta.len())
            .unwrap_or(0);
        let needed = size.saturating_sub(written) + Self::DISK_MARGIN_BYTES;
        let runtime = self.runtime.clone();
        let path = destination.to_path_buf();
        let available = tokio::task::spawn_blocking(move || runtime.available_space(&path))
            .await
            .map_err(|e| Error::OperationFailed(e.to_string()))?;
        match available {
            Some(available) if available < needed => {
                Err(Error::InsufficientDiskSpace { needed, available })
            }
            _ => Ok(()),
        }
    }

    pub async fn cancel_download(&self, model: &M) -> Result<bool, Error> {
        let key = model.download_key();

        let existing = self.downloads.remove(&key).await;

        if let Some(entry) = existing {
            entry.token.cancel();
            wait_for_task_exit(entry.task, Self::TASK_JOIN_WARN_AFTER, "cancel_download").await;
            self.runtime.emit_progress(
                model,
                crate::runtime::DownloadStatus::Failed("Download cancelled".to_string()),
            );
            let _ = fs::remove_file(entry.download_path).await;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub async fn delete(&self, model: &M) -> Result<(), Error> {
        if !self.is_downloaded(model).await? {
            return Err(Error::ModelNotDownloaded(model.download_key()));
        }

        let models_base = self.runtime.models_base()?;
        let model_clone = model.clone();
        tokio::task::spawn_blocking(move || model_clone.delete_downloaded(&models_base))
            .await
            .map_err(|e| Error::OperationFailed(e.to_string()))?
    }
}
