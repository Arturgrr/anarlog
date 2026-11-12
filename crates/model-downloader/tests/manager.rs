use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use model_downloader::{
    DownloadStatus, DownloadableModel, Error, ModelDownloadManager, ModelDownloaderRuntime,
};

// --- test fixtures ---

struct TestRuntime {
    temp_dir: Arc<tempfile::TempDir>,
    progress_log: Arc<Mutex<Vec<(String, model_downloader::DownloadStatus)>>>,
    available_space: Option<u64>,
}

impl TestRuntime {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            temp_dir: Arc::new(tempfile::TempDir::new().unwrap()),
            progress_log: Arc::new(Mutex::new(Vec::new())),
            available_space: None,
        })
    }

    fn with_available_space(bytes: u64) -> Arc<Self> {
        Arc::new(Self {
            available_space: Some(bytes),
            ..Arc::into_inner(Self::new()).unwrap()
        })
    }

    fn progress_statuses(&self) -> Vec<model_downloader::DownloadStatus> {
        self.progress_log
            .lock()
            .unwrap()
            .iter()
            .map(|(_, s)| s.clone())
            .collect()
    }
}

impl ModelDownloaderRuntime<TestModel> for TestRuntime {
    fn models_base(&self) -> Result<PathBuf, Error> {
        Ok(self.temp_dir.path().to_path_buf())
    }

    fn emit_progress(&self, model: &TestModel, status: model_downloader::DownloadStatus) {
        self.progress_log
            .lock()
            .unwrap()
            .push((model.download_key(), status));
    }

    fn available_space(&self, _path: &Path) -> Option<u64> {
        self.available_space
    }
}

#[derive(Clone)]
struct TestModel {
    key: String,
    url: Option<String>,
    checksum: Option<u32>,
    sha256: Option<String>,
    size: Option<u64>,
}

impl TestModel {
    fn with_url(key: &str, url: String) -> Self {
        Self {
            key: key.to_string(),
            url: Some(url),
            checksum: None,
            sha256: None,
            size: None,
        }
    }

    fn with_url_and_checksum(key: &str, url: String, checksum: u32) -> Self {
        Self {
            checksum: Some(checksum),
            ..Self::with_url(key, url)
        }
    }

    fn with_url_and_sha256(key: &str, url: String, sha256: &str, size: u64) -> Self {
        Self {
            sha256: Some(sha256.to_string()),
            size: Some(size),
            ..Self::with_url(key, url)
        }
    }

    fn without_url(key: &str) -> Self {
        Self {
            url: None,
            ..Self::with_url(key, String::new())
        }
    }
}

impl DownloadableModel for TestModel {
    fn download_key(&self) -> String {
        self.key.clone()
    }

    fn download_url(&self) -> Option<String> {
        self.url.clone()
    }

    fn download_checksum(&self) -> Option<u32> {
        self.checksum
    }

    fn download_sha256(&self) -> Option<String> {
        self.sha256.clone()
    }

    fn download_size(&self) -> Option<u64> {
        self.size
    }

    fn download_destination(&self, models_base: &Path) -> PathBuf {
        models_base.join(format!("{}.bin", self.key))
    }

    fn is_downloaded(&self, models_base: &Path) -> Result<bool, Error> {
        Ok(self.download_destination(models_base).exists())
    }

    fn finalize_download(&self, _downloaded_path: &Path, _models_base: &Path) -> Result<(), Error> {
        Ok(())
    }

    fn delete_downloaded(&self, models_base: &Path) -> Result<(), Error> {
        std::fs::remove_file(self.download_destination(models_base)).map_err(Error::Io)
    }
}

// --- helpers ---

async fn start_mock_server(route: &str, body: Vec<u8>) -> MockServer {
    let server = MockServer::start().await;
    let len = body.len().to_string();

    Mock::given(method("HEAD"))
        .and(path(route))
        .respond_with(ResponseTemplate::new(200).insert_header("content-length", len.as_str()))
        .mount(&server)
        .await;

    Mock::given(method("GET"))
        .and(path(route))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_bytes(body)
                .insert_header("content-length", len.as_str()),
        )
        .mount(&server)
        .await;

    server
}

async fn start_mock_server_with_delay(route: &str, body: Vec<u8>, delay: Duration) -> MockServer {
    let server = MockServer::start().await;
    let len = body.len().to_string();

    Mock::given(method("HEAD"))
        .and(path(route))
        .respond_with(ResponseTemplate::new(200).insert_header("content-length", len.as_str()))
        .mount(&server)
        .await;

    Mock::given(method("GET"))
        .and(path(route))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_bytes(body)
                .insert_header("content-length", len.as_str())
                .set_delay(delay),
        )
        .mount(&server)
        .await;

    server
}

async fn wait_until_done(manager: &ModelDownloadManager<TestModel>, model: &TestModel) {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if !manager.is_downloading(model).await {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("download did not complete within 10s");
}

fn sha256_hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let digest = <sha2::Sha256 as sha2::Digest>::digest(bytes);
    digest.iter().fold(String::new(), |mut hex, byte| {
        let _ = write!(hex, "{byte:02x}");
        hex
    })
}

fn part_files_in(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let is_part = path
                .file_name()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s.ends_with(".part"));
            if is_part {
                out.push(path);
            }
        }
    }
    out
}

// --- tests ---

#[tokio::test]
async fn download_success() {
    let server = start_mock_server("/model.bin", b"fake weights".to_vec()).await;
    let url = format!("{}/model.bin", server.uri());

    let runtime = TestRuntime::new();
    let manager = ModelDownloadManager::new(runtime.clone());
    let model = TestModel::with_url("success", url);

    manager.download(&model).await.unwrap();
    wait_until_done(&manager, &model).await;

    assert!(manager.is_downloaded(&model).await.unwrap());
    assert!(!manager.is_downloading(&model).await);

    let events = runtime.progress_statuses();
    assert!(
        events.contains(&DownloadStatus::Downloading(0)),
        "should emit Downloading(0) (started): {events:?}"
    );
    assert!(
        events.contains(&DownloadStatus::Completed),
        "should emit Completed: {events:?}"
    );
}

#[tokio::test]
async fn stale_cleanup_does_not_remove_replacement_download() {
    let slow_server =
        start_mock_server_with_delay("/model.bin", vec![1u8; 1024], Duration::from_millis(500))
            .await;
    let fast_server = start_mock_server("/model.bin", vec![2u8; 1024]).await;

    let runtime = TestRuntime::new();
    let manager = ModelDownloadManager::new(runtime.clone());
    let first = TestModel::with_url("replace", format!("{}/model.bin", slow_server.uri()));
    let second = TestModel::with_url("replace", format!("{}/model.bin", fast_server.uri()));

    manager.download(&first).await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;

    manager.download(&second).await.unwrap();
    wait_until_done(&manager, &second).await;

    assert!(manager.is_downloaded(&second).await.unwrap());
    assert!(!manager.is_downloading(&second).await);
    assert!(
        part_files_in(runtime.temp_dir.path()).is_empty(),
        "should not leave .part files behind"
    );
}

#[tokio::test]
async fn download_no_url_returns_error() {
    let runtime = TestRuntime::new();
    let manager = ModelDownloadManager::new(runtime.clone());
    let model = TestModel::without_url("no_url");

    let result = manager.download(&model).await;

    assert!(matches!(result, Err(Error::NoDownloadUrl(_))));
}

#[tokio::test]
async fn cancel_download_returns_false_when_idle() {
    let runtime = TestRuntime::new();
    let manager = ModelDownloadManager::new(runtime.clone());
    let model = TestModel::without_url("idle");

    let cancelled = manager.cancel_download(&model).await.unwrap();

    assert!(!cancelled);
}

#[tokio::test]
async fn cancel_download_returns_true_and_cleans_up() {
    let server = MockServer::start().await;

    Mock::given(method("HEAD"))
        .and(path("/slow.bin"))
        .respond_with(ResponseTemplate::new(200).insert_header("content-length", "1024"))
        .mount(&server)
        .await;

    Mock::given(method("GET"))
        .and(path("/slow.bin"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_bytes(vec![0u8; 1024])
                .set_delay(Duration::from_millis(500)),
        )
        .mount(&server)
        .await;

    let url = format!("{}/slow.bin", server.uri());
    let runtime = TestRuntime::new();
    let manager = ModelDownloadManager::new(runtime.clone());
    let model = TestModel::with_url("cancel_target", url);

    manager.download(&model).await.unwrap();

    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(manager.is_downloading(&model).await);

    let cancelled = manager.cancel_download(&model).await.unwrap();

    assert!(cancelled);
    assert!(!manager.is_downloading(&model).await);
    assert!(!manager.is_downloaded(&model).await.unwrap());
    assert!(
        runtime
            .progress_statuses()
            .iter()
            .any(|s| matches!(s, DownloadStatus::Failed(_))),
        "should emit -1 on cancellation"
    );
    assert!(
        part_files_in(runtime.temp_dir.path()).is_empty(),
        "should not leave .part files behind"
    );
}

#[tokio::test]
async fn download_rejected_by_the_server_leaves_no_part_file() {
    let server = MockServer::start().await;

    Mock::given(method("HEAD"))
        .and(path("/fail.bin"))
        .respond_with(ResponseTemplate::new(200).insert_header("content-length", "1024"))
        .mount(&server)
        .await;

    Mock::given(method("GET"))
        .and(path("/fail.bin"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;

    let url = format!("{}/fail.bin", server.uri());
    let runtime = TestRuntime::new();
    let manager = ModelDownloadManager::new(runtime.clone());
    let model = TestModel::with_url("fail", url);

    manager.download(&model).await.unwrap();
    wait_until_done(&manager, &model).await;

    assert!(!manager.is_downloading(&model).await);
    assert!(!manager.is_downloaded(&model).await.unwrap());
    assert!(
        runtime
            .progress_statuses()
            .iter()
            .any(|s| matches!(s, DownloadStatus::Failed(_))),
        "should emit -1 on download failure"
    );
    assert!(
        part_files_in(runtime.temp_dir.path()).is_empty(),
        "should not leave .part files behind"
    );
}

#[tokio::test]
async fn checksum_mismatch_cleans_up_part_file() {
    let body = b"checksum target".to_vec();
    let server = start_mock_server("/checksum.bin", body).await;
    let url = format!("{}/checksum.bin", server.uri());
    let runtime = TestRuntime::new();
    let manager = ModelDownloadManager::new(runtime.clone());
    let model = TestModel::with_url_and_checksum("checksum_fail", url, 123);

    manager.download(&model).await.unwrap();
    wait_until_done(&manager, &model).await;

    assert!(!manager.is_downloading(&model).await);
    assert!(!manager.is_downloaded(&model).await.unwrap());
    assert!(
        runtime
            .progress_statuses()
            .iter()
            .any(|s| matches!(s, DownloadStatus::Failed(_))),
        "should emit -1 on checksum mismatch"
    );
    assert!(
        part_files_in(runtime.temp_dir.path()).is_empty(),
        "should not leave .part files behind"
    );
}

/// A pinned model whose bytes differ from its SHA-256 or size must never be
/// promoted to the models directory; one that matches is.
#[tokio::test]
async fn sha256_or_size_mismatch_is_rejected_and_a_match_is_installed() {
    let body = b"pinned model bytes".to_vec();
    let sha256 = "0".repeat(64);
    let actual_sha256 = sha256_hex(&body);
    let size = body.len() as u64;
    let server = start_mock_server("/pinned.gguf", body).await;
    let url = format!("{}/pinned.gguf", server.uri());

    for (model, installed) in [
        (
            TestModel::with_url_and_sha256("wrong_sha", url.clone(), &sha256, size),
            false,
        ),
        (
            TestModel::with_url_and_sha256("wrong_size", url.clone(), &actual_sha256, size + 1),
            false,
        ),
        (
            TestModel::with_url_and_sha256(
                "pinned",
                url.clone(),
                &actual_sha256.to_uppercase(),
                size,
            ),
            true,
        ),
    ] {
        let runtime = TestRuntime::new();
        let manager = ModelDownloadManager::new(runtime.clone());
        manager.download(&model).await.unwrap();
        wait_until_done(&manager, &model).await;

        assert_eq!(
            manager.is_downloaded(&model).await.unwrap(),
            installed,
            "{}",
            model.key
        );
        let statuses = runtime.progress_statuses();
        assert_eq!(
            statuses
                .iter()
                .any(|s| matches!(s, DownloadStatus::Failed(_))),
            !installed,
            "{}: {statuses:?}",
            model.key
        );
        assert!(
            part_files_in(runtime.temp_dir.path()).is_empty(),
            "{}",
            model.key
        );
    }
}

#[tokio::test]
async fn cancel_download_immediately_after_start_returns_true() {
    let server =
        start_mock_server_with_delay("/slow.bin", vec![0u8; 1024], Duration::from_millis(500))
            .await;
    let url = format!("{}/slow.bin", server.uri());

    let runtime = TestRuntime::new();
    let manager = ModelDownloadManager::new(runtime.clone());
    let model = TestModel::with_url("immediate_cancel", url);

    manager.download(&model).await.unwrap();
    let cancelled = manager.cancel_download(&model).await.unwrap();

    assert!(cancelled);
    assert!(!manager.is_downloading(&model).await);
    assert!(
        runtime
            .progress_statuses()
            .iter()
            .any(|s| matches!(s, DownloadStatus::Failed(_))),
        "should emit -1 on cancellation"
    );
}

#[tokio::test]
async fn is_downloading_stays_true_during_replacement() {
    let slow_server =
        start_mock_server_with_delay("/model.bin", vec![1u8; 1024], Duration::from_millis(700))
            .await;
    let fast_server = start_mock_server("/model.bin", vec![2u8; 1024]).await;

    let runtime = TestRuntime::new();
    let manager = ModelDownloadManager::new(runtime.clone());
    let first = TestModel::with_url("replace_busy", format!("{}/model.bin", slow_server.uri()));
    let second = TestModel::with_url("replace_busy", format!("{}/model.bin", fast_server.uri()));

    manager.download(&first).await.unwrap();
    tokio::time::sleep(Duration::from_millis(30)).await;

    let manager_for_task = manager.clone();
    let second_for_task = second.clone();
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let replacer = tokio::spawn(async move {
        let _ = started_tx.send(());
        manager_for_task.download(&second_for_task).await.unwrap();
    });
    started_rx.await.unwrap();

    for _ in 0..20 {
        assert!(manager.is_downloading(&second).await);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    replacer.await.unwrap();
    wait_until_done(&manager, &second).await;
    assert!(!manager.is_downloading(&second).await);
}

#[tokio::test]
async fn delete_success() {
    let runtime = TestRuntime::new();
    let manager = ModelDownloadManager::new(runtime.clone());
    let model = TestModel::without_url("to_delete");

    std::fs::write(manager.model_path(&model).unwrap(), b"weights").unwrap();
    assert!(manager.is_downloaded(&model).await.unwrap());

    manager.delete(&model).await.unwrap();

    assert!(!manager.is_downloaded(&model).await.unwrap());
}

#[tokio::test]
async fn delete_not_downloaded_returns_error() {
    let runtime = TestRuntime::new();
    let manager = ModelDownloadManager::new(runtime.clone());
    let model = TestModel::without_url("ghost");

    let result = manager.delete(&model).await;

    assert!(matches!(result, Err(Error::ModelNotDownloaded(_))));
}

/// A multi-gigabyte model whose download broke off must continue from the
/// bytes already on disk, not start over.
#[tokio::test]
async fn failed_download_keeps_its_part_and_the_next_attempt_resumes() {
    let body: Vec<u8> = (0..64 * 1024u32).map(|i| (i % 251) as u8).collect();
    let half = body.len() / 2;
    let server = MockServer::start().await;
    let len = body.len().to_string();
    Mock::given(method("HEAD"))
        .and(path("/big.gguf"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-length", len.as_str())
                .insert_header("accept-ranges", "bytes"),
        )
        .mount(&server)
        .await;
    // The first attempt finds the server failing; the second gets the rest.
    Mock::given(method("GET"))
        .and(path("/big.gguf"))
        .respond_with(ResponseTemplate::new(503))
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/big.gguf"))
        .and(header("range", format!("bytes={half}-").as_str()))
        .respond_with(
            ResponseTemplate::new(206)
                .set_body_bytes(body[half..].to_vec())
                .insert_header("content-length", (body.len() - half).to_string().as_str()),
        )
        .with_priority(2)
        .mount(&server)
        .await;

    let runtime = TestRuntime::new();
    let manager = ModelDownloadManager::new(runtime.clone());
    let model = TestModel::with_url_and_sha256(
        "resumed",
        format!("{}/big.gguf", server.uri()),
        &sha256_hex(&body),
        body.len() as u64,
    );
    let destination = manager.model_path(&model).unwrap();
    let part = destination.with_file_name("resumed.bin.part");
    std::fs::write(&part, &body[..half]).unwrap();

    manager.download(&model).await.unwrap();
    wait_until_done(&manager, &model).await;
    assert!(!manager.is_downloaded(&model).await.unwrap());
    assert_eq!(std::fs::read(&part).unwrap(), body[..half]);

    manager.download(&model).await.unwrap();
    wait_until_done(&manager, &model).await;
    assert!(manager.is_downloaded(&model).await.unwrap());
    assert_eq!(std::fs::read(&destination).unwrap(), body);
    assert!(part_files_in(runtime.temp_dir.path()).is_empty());
}

/// A download of known size must not start when it would leave less than
/// about 1 GB free.
#[tokio::test]
async fn download_without_room_for_the_file_and_a_margin_is_refused() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200))
        .expect(0)
        .mount(&server)
        .await;
    let size = 2_000_000_000;
    let model = TestModel::with_url_and_sha256(
        "large",
        format!("{}/large.gguf", server.uri()),
        &"0".repeat(64),
        size,
    );

    let runtime = TestRuntime::with_available_space(size + 999_999_999);
    let manager = ModelDownloadManager::new(runtime.clone());
    let result = manager.download(&model).await;

    assert!(
        matches!(result, Err(Error::InsufficientDiskSpace { needed, .. }) if needed == size + 1_000_000_000),
        "{result:?}"
    );
    assert!(!manager.is_downloading(&model).await);
}
