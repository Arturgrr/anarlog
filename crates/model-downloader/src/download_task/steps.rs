use tokio::fs;

use crate::Error;
use crate::download_task::params::DownloadTaskParams;
use crate::model::DownloadableModel;

pub(super) enum ChecksumError {
    Mismatch {
        kind: &'static str,
        actual: String,
        expected: String,
    },
    Calculate(anlg_file::Error),
    Join(tokio::task::JoinError),
}

/// What a finished download must match: its size, CRC32 and SHA-256, each
/// when the model pins it.
pub(super) struct Expected {
    pub(super) size: Option<u64>,
    pub(super) crc32: Option<u32>,
    pub(super) sha256: Option<String>,
}

impl Expected {
    pub(super) fn of<M: DownloadableModel>(model: &M) -> Option<Self> {
        let expected = Self {
            size: model.download_size(),
            crc32: model.download_checksum(),
            sha256: model.download_sha256().map(|sha| sha.to_ascii_lowercase()),
        };
        (expected.size.is_some() || expected.crc32.is_some() || expected.sha256.is_some())
            .then_some(expected)
    }
}

pub(super) enum FinalizeError {
    Finalize(Error),
    Join(tokio::task::JoinError),
}

pub(super) async fn download<M: DownloadableModel>(
    params: &DownloadTaskParams<M>,
    progress_callback: impl Fn(anlg_download_interface::DownloadProgress) + Send + Sync,
) -> Result<(), anlg_file::Error> {
    anlg_file::download_file_parallel_cancellable(
        &params.url,
        &params.destination,
        progress_callback,
        Some(params.cancellation_token.clone()),
    )
    .await
}

pub(super) async fn verify_checksum<M: DownloadableModel>(
    params: &DownloadTaskParams<M>,
    expected: Expected,
) -> Result<(), ChecksumError> {
    let path = params.destination.clone();
    tokio::task::spawn_blocking(move || verify_file(&path, &expected))
        .await
        .map_err(ChecksumError::Join)?
}

fn verify_file(path: &std::path::Path, expected: &Expected) -> Result<(), ChecksumError> {
    if let Some(size) = expected.size {
        let actual = anlg_file::file_size(path).map_err(ChecksumError::Calculate)?;
        if actual != size {
            return Err(ChecksumError::Mismatch {
                kind: "size",
                actual: actual.to_string(),
                expected: size.to_string(),
            });
        }
    }
    if let Some(crc32) = expected.crc32 {
        let actual = anlg_file::calculate_file_checksum(path).map_err(ChecksumError::Calculate)?;
        if actual != crc32 {
            return Err(ChecksumError::Mismatch {
                kind: "crc32",
                actual: actual.to_string(),
                expected: crc32.to_string(),
            });
        }
    }
    if let Some(sha256) = &expected.sha256 {
        let actual = sha256_hex(path).map_err(|error| ChecksumError::Calculate(error.into()))?;
        if &actual != sha256 {
            return Err(ChecksumError::Mismatch {
                kind: "sha256",
                actual,
                expected: sha256.clone(),
            });
        }
    }
    Ok(())
}

fn sha256_hex(path: &std::path::Path) -> std::io::Result<String> {
    use sha2::Digest;
    use std::io::Read;

    let mut file = std::fs::File::open(path)?;
    let mut hasher = sha2::Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

pub(super) async fn finalize<M: DownloadableModel>(
    params: &DownloadTaskParams<M>,
) -> Result<(), FinalizeError> {
    let destination_for_finalize = params.destination.clone();
    let model_for_finalize = params.model.clone();
    let models_base_for_finalize = params.models_base.clone();
    let finalize_result = tokio::task::spawn_blocking(move || {
        model_for_finalize.finalize_download(&destination_for_finalize, &models_base_for_finalize)
    })
    .await;

    match finalize_result {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(FinalizeError::Finalize(e)),
        Err(e) => Err(FinalizeError::Join(e)),
    }
}

pub(super) async fn promote<M: DownloadableModel>(
    params: &DownloadTaskParams<M>,
) -> Result<(), std::io::Error> {
    match fs::rename(&params.destination, &params.final_destination).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let _ = fs::remove_file(&params.final_destination).await;
            fs::rename(&params.destination, &params.final_destination).await
        }
        Err(e) => Err(e),
    }
}
