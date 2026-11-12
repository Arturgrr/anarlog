use tokio::fs;

use crate::download_task::params::DownloadTaskParams;
use crate::model::DownloadableModel;

pub(super) async fn cleanup_for_failure<M: DownloadableModel>(params: &DownloadTaskParams<M>) {
    let _ = fs::remove_file(&params.destination).await;
    forget_task(params).await;
}

pub(super) async fn forget_task<M: DownloadableModel>(params: &DownloadTaskParams<M>) {
    params
        .registry
        .remove_if_generation_matches(&params.key, params.generation)
        .await;
}
