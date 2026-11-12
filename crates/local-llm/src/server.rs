//! Starts, supervises and stops one `llama-server` at a time.
//!
//! The server is a child process of the app, outside the app's actor
//! supervisor: a server that crashes on start is retried at most
//! `max_failed_starts` times before it stays failed until someone asks
//! again (`stop`), so it never crash-loops the app.

use std::collections::VecDeque;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex, Weak};
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, oneshot, watch};
use tokio_util::sync::CancellationToken;

use crate::args::{Launch, server_args, server_environment};
use crate::process;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ServerState {
    Stopped,
    Starting {
        model: String,
    },
    Ready {
        model: String,
        context: u32,
    },
    #[serde(rename_all = "camelCase")]
    Failed {
        model: String,
        message: String,
        attempts: u32,
        /// It failed `max_failed_starts` times in a row and is not started
        /// again until `stop` clears it.
        gave_up: bool,
    },
}

/// Where and how to reach a ready server.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    /// `http://127.0.0.1:<port>/v1`
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub context: u32,
}

pub struct ServerConfig {
    pub binary: PathBuf,
    /// Arguments placed before the server's own; tests run a stand-in
    /// server through an interpreter with these.
    pub leading_args: Vec<OsString>,
    /// Holds the pidfile.
    pub state_dir: PathBuf,
    pub idle_stop_after: Duration,
    pub idle_poll_interval: Duration,
    pub start_timeout: Duration,
    pub max_failed_starts: u32,
}

impl ServerConfig {
    pub fn new(binary: PathBuf, state_dir: PathBuf) -> Self {
        Self {
            binary,
            leading_args: Vec::new(),
            state_dir,
            idle_stop_after: Duration::from_secs(5 * 60),
            idle_poll_interval: Duration::from_secs(30),
            start_timeout: Duration::from_secs(180),
            max_failed_starts: 3,
        }
    }

    /// The server sleeps (unloads the model) a minute after Librelog would
    /// have stopped it, which frees the memory when Librelog was killed.
    fn sleep_idle_seconds(&self) -> u64 {
        self.idle_stop_after.as_secs() + 60
    }
}

pub struct LaunchRequest {
    /// The catalog id, which requests send as `model`.
    pub model: String,
    pub model_path: PathBuf,
    pub context: u32,
}

#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error("{0}")]
    StartFailed(String),
    /// Too many failed starts in a row; `stop` clears it.
    #[error("{0}")]
    GaveUp(String),
}

type StateListener = Box<dyn Fn(&ServerState) + Send + Sync>;

#[derive(Clone)]
pub struct ServerManager {
    inner: Arc<Inner>,
}

struct Inner {
    config: ServerConfig,
    http: reqwest::Client,
    epoch: Instant,
    generation: AtomicU64,
    running: Mutex<Option<Running>>,
    status: StdMutex<Status>,
    pid: StdMutex<Option<u32>>,
    listener: StateListener,
}

struct Status {
    state: ServerState,
    failures: u32,
    failed_model: Option<String>,
    last_error: String,
}

struct Running {
    generation: u64,
    endpoint: Endpoint,
    stop_tx: Option<oneshot::Sender<()>>,
    exited: watch::Receiver<bool>,
    activity: Arc<AtomicU64>,
    stop_idle: CancellationToken,
}

impl ServerManager {
    pub fn new(
        config: ServerConfig,
        listener: impl Fn(&ServerState) + Send + Sync + 'static,
    ) -> Self {
        let http = reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap_or_default();
        Self {
            inner: Arc::new(Inner {
                config,
                http,
                epoch: Instant::now(),
                generation: AtomicU64::new(0),
                running: Mutex::new(None),
                status: StdMutex::new(Status {
                    state: ServerState::Stopped,
                    failures: 0,
                    failed_model: None,
                    last_error: String::new(),
                }),
                pid: StdMutex::new(None),
                listener: Box::new(listener),
            }),
        }
    }

    pub fn state(&self) -> ServerState {
        self.inner.status().state.clone()
    }

    /// Stops a server an earlier, killed run of the app left behind. Holds
    /// the start lock, so it never mistakes a server this run just started
    /// for a stale one.
    pub async fn reap_stale(&self) -> Option<u32> {
        let running = self.inner.running.lock().await;
        if running.is_some() {
            return None;
        }
        let state_dir = self.inner.config.state_dir.clone();
        let binary = self.inner.config.binary.clone();
        tokio::task::spawn_blocking(move || process::reap_stale_server(&state_dir, &binary))
            .await
            .ok()
            .flatten()
    }

    /// Returns the running server for `request`, starting it (and stopping
    /// a server for another model or context) when needed. Each call counts
    /// as activity for the idle stop.
    pub async fn ensure(&self, request: LaunchRequest) -> Result<Endpoint, ServerError> {
        let inner = &self.inner;
        let mut running = inner.running.lock().await;

        if let Some(current) = running.as_ref()
            && current.endpoint.model == request.model
            && current.endpoint.context == request.context
            && !*current.exited.borrow()
        {
            current.touch(inner.now_ms());
            return Ok(current.endpoint.clone());
        }
        if let Some(current) = running.take() {
            inner.shut_down(current).await;
        }

        {
            let mut status = inner.status();
            if status.failed_model.as_deref() != Some(request.model.as_str()) {
                status.failures = 0;
                status.failed_model = None;
            } else if status.failures >= inner.config.max_failed_starts {
                return Err(ServerError::GaveUp(status.last_error.clone()));
            }
        }

        inner.set_state(ServerState::Starting {
            model: request.model.clone(),
        });
        match Inner::start(inner, &request).await {
            Ok(started) => {
                let endpoint = started.endpoint.clone();
                *running = Some(started);
                {
                    let mut status = inner.status();
                    status.failures = 0;
                    status.failed_model = None;
                }
                inner.set_state(ServerState::Ready {
                    model: endpoint.model.clone(),
                    context: endpoint.context,
                });
                Ok(endpoint)
            }
            Err(message) => {
                tracing::warn!(model = %request.model, %message, "llama_server_start_failed");
                inner.record_failure(&request.model, message.clone());
                Err(ServerError::StartFailed(message))
            }
        }
    }

    /// Stops the server, if any, and clears a failed state so the next
    /// `ensure` tries again.
    pub async fn stop(&self) {
        let mut running = self.inner.running.lock().await;
        if let Some(current) = running.take() {
            self.inner.shut_down(current).await;
        }
        {
            let mut status = self.inner.status();
            status.failures = 0;
            status.failed_model = None;
        }
        self.inner.set_state(ServerState::Stopped);
    }

    /// For the app's exit, where nothing async runs any more: ends the
    /// server process without waiting for its supervisor.
    pub fn shutdown_blocking(&self) {
        let pid = self
            .inner
            .pid
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take();
        if let Some(pid) = pid {
            process::stop_process(pid, &self.inner.config.binary, Duration::from_millis(500));
            process::clear_pidfile(&self.inner.config.state_dir, pid);
        }
    }
}

impl Running {
    fn touch(&self, now_ms: u64) {
        self.activity.store(now_ms, Ordering::Relaxed);
    }
}

enum Readiness {
    Ready,
    Exited,
    TimedOut,
}

const PORT_ATTEMPTS: usize = 3;
const LOG_LINES: usize = 64;

impl Inner {
    fn status(&self) -> std::sync::MutexGuard<'_, Status> {
        self.status
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }

    fn set_state(&self, state: ServerState) {
        let changed = {
            let mut status = self.status();
            let changed = status.state != state;
            status.state = state.clone();
            changed
        };
        if changed {
            (self.listener)(&state);
        }
    }

    fn record_failure(&self, model: &str, message: String) {
        let (attempts, gave_up) = {
            let mut status = self.status();
            if status.failed_model.as_deref() == Some(model) {
                status.failures += 1;
            } else {
                status.failures = 1;
                status.failed_model = Some(model.to_string());
            }
            status.last_error = message.clone();
            (
                status.failures,
                status.failures >= self.config.max_failed_starts,
            )
        };
        self.set_state(ServerState::Failed {
            model: model.to_string(),
            message,
            attempts,
            gave_up,
        });
    }

    fn now_ms(&self) -> u64 {
        self.epoch.elapsed().as_millis() as u64
    }

    fn set_pid(&self, pid: Option<u32>) {
        *self.pid.lock().unwrap_or_else(|error| error.into_inner()) = pid;
    }

    async fn start(this: &Arc<Self>, request: &LaunchRequest) -> Result<Running, String> {
        let config = &this.config;
        let (state_dir, binary) = (config.state_dir.clone(), config.binary.clone());
        let _ =
            tokio::task::spawn_blocking(move || process::reap_stale_server(&state_dir, &binary))
                .await;

        let mut last_error = String::new();
        for _ in 0..PORT_ATTEMPTS {
            let port = free_port().map_err(|error| format!("No free local port: {error}"))?;
            let api_key = new_api_key();

            let mut command = Command::new(&config.binary);
            command
                .args(&config.leading_args)
                .args(server_args(&Launch {
                    model_path: &request.model_path,
                    alias: &request.model,
                    port,
                    context: request.context,
                    sleep_idle_seconds: config.sleep_idle_seconds(),
                }))
                .env_clear()
                .envs(server_environment(std::env::vars_os(), &api_key))
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true);
            die_with_parent(&mut command);

            let mut child = command
                .spawn()
                .map_err(|error| format!("Could not start the built-in model server: {error}"))?;
            let pid = child.id().unwrap_or_default();
            process::write_pidfile(&config.state_dir, pid, &config.binary);
            this.set_pid(Some(pid));

            let log = Arc::new(StdMutex::new(VecDeque::with_capacity(LOG_LINES)));
            if let Some(stdout) = child.stdout.take() {
                collect_output(stdout, log.clone());
            }
            if let Some(stderr) = child.stderr.take() {
                collect_output(stderr, log.clone());
            }

            let generation = this.generation.fetch_add(1, Ordering::Relaxed) + 1;
            let (exited_tx, exited) = watch::channel(false);
            let (stop_tx, stop_rx) = oneshot::channel();
            tokio::spawn(supervise(
                Arc::downgrade(this),
                generation,
                child,
                pid,
                stop_rx,
                exited_tx,
            ));

            let base_url = format!("http://127.0.0.1:{port}");
            let running = Running {
                generation,
                endpoint: Endpoint {
                    base_url: format!("{base_url}/v1"),
                    api_key,
                    model: request.model.clone(),
                    context: request.context,
                },
                stop_tx: Some(stop_tx),
                exited: exited.clone(),
                activity: Arc::new(AtomicU64::new(this.now_ms())),
                stop_idle: CancellationToken::new(),
            };

            match wait_ready(&this.http, &base_url, exited, config.start_timeout).await {
                Readiness::Ready => {
                    tokio::spawn(stop_when_idle(
                        Arc::downgrade(this),
                        generation,
                        running.endpoint.clone(),
                        running.activity.clone(),
                        running.stop_idle.clone(),
                    ));
                    tracing::info!(model = %request.model, context = request.context, "llama_server_ready");
                    return Ok(running);
                }
                Readiness::Exited => {
                    this.set_pid(None);
                    let lines = log_lines(&log);
                    if lines.iter().any(|line| line.contains("couldn't bind")) {
                        last_error = "The local port was taken".to_string();
                        continue;
                    }
                    for line in &lines {
                        tracing::warn!(target: "llama_server", "{line}");
                    }
                    return Err(start_failure_message(&lines));
                }
                Readiness::TimedOut => {
                    this.shut_down(running).await;
                    return Err(format!(
                        "The built-in model did not finish loading within {} seconds.",
                        config.start_timeout.as_secs()
                    ));
                }
            }
        }
        Err(last_error)
    }

    async fn shut_down(&self, mut running: Running) {
        running.stop_idle.cancel();
        if let Some(stop) = running.stop_tx.take() {
            let _ = stop.send(());
        }
        let _ = tokio::time::timeout(
            Duration::from_secs(10),
            running.exited.wait_for(|exited| *exited),
        )
        .await;
        self.set_pid(None);
    }

    async fn on_unexpected_exit(&self, generation: u64, message: String) {
        let mut running = self.running.lock().await;
        let Some(current) = running.take_if(|current| current.generation == generation) else {
            return;
        };
        current.stop_idle.cancel();
        self.set_pid(None);
        tracing::warn!(%message, "llama_server_exited");
        self.record_failure(&current.endpoint.model, message);
    }

    async fn stop_if_current(&self, generation: u64) {
        let mut running = self.running.lock().await;
        let Some(current) = running.take_if(|current| current.generation == generation) else {
            return;
        };
        tracing::info!(model = %current.endpoint.model, "llama_server_idle_stop");
        self.shut_down(current).await;
        self.set_state(ServerState::Stopped);
    }

    /// Whether a slot is generating, or the answer could not be read.
    async fn busy(&self, endpoint: &Endpoint) -> bool {
        let url = format!("{}/slots", endpoint.base_url.trim_end_matches("/v1"));
        let response = self
            .http
            .get(url)
            .bearer_auth(&endpoint.api_key)
            .timeout(Duration::from_secs(5))
            .send()
            .await;
        let Ok(response) = response else {
            return false;
        };
        let Ok(body) = response.bytes().await else {
            return false;
        };
        let Ok(slots) = serde_json::from_slice::<Vec<serde_json::Value>>(&body) else {
            return false;
        };
        slots.iter().any(|slot| {
            slot.get("is_processing")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
        })
    }
}

/// Owns the child: waits for it to exit, or ends it when asked (or when
/// the `Running` that asks is dropped).
async fn supervise(
    inner: Weak<Inner>,
    generation: u64,
    mut child: Child,
    pid: u32,
    stop_rx: oneshot::Receiver<()>,
    exited_tx: watch::Sender<bool>,
) {
    let unexpected = tokio::select! {
        status = child.wait() => Some(status),
        _ = stop_rx => {
            terminate(&mut child).await;
            None
        }
    };
    if let Some(inner) = inner.upgrade() {
        process::clear_pidfile(&inner.config.state_dir, pid);
    }
    let _ = exited_tx.send(true);

    if let Some(status) = unexpected
        && let Some(inner) = inner.upgrade()
    {
        let status = match status {
            Ok(status) => status.to_string(),
            Err(error) => error.to_string(),
        };
        inner
            .on_unexpected_exit(
                generation,
                format!("The built-in model server stopped unexpectedly ({status})."),
            )
            .await;
    }
}

async fn terminate(child: &mut Child) {
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        // SAFETY: kill(2) on our own child's pid; it cannot have been
        // reaped (and the pid reused) while we hold the Child.
        unsafe {
            libc::kill(pid as libc::pid_t, libc::SIGTERM);
        }
    }
    #[cfg(not(unix))]
    let _ = child.start_kill();

    if tokio::time::timeout(Duration::from_secs(5), child.wait())
        .await
        .is_err()
    {
        let _ = child.kill().await;
    }
}

async fn stop_when_idle(
    inner: Weak<Inner>,
    generation: u64,
    endpoint: Endpoint,
    activity: Arc<AtomicU64>,
    cancel: CancellationToken,
) {
    loop {
        let poll = match inner.upgrade() {
            Some(inner) => inner.config.idle_poll_interval,
            None => return,
        };
        tokio::select! {
            _ = cancel.cancelled() => return,
            _ = tokio::time::sleep(poll) => {}
        }
        let Some(inner) = inner.upgrade() else {
            return;
        };
        let idle_ms = inner
            .now_ms()
            .saturating_sub(activity.load(Ordering::Relaxed));
        if idle_ms < inner.config.idle_stop_after.as_millis() as u64 {
            continue;
        }
        if inner.busy(&endpoint).await {
            activity.store(inner.now_ms(), Ordering::Relaxed);
            continue;
        }
        if cancel.is_cancelled() {
            return;
        }
        inner.stop_if_current(generation).await;
        return;
    }
}

async fn wait_ready(
    http: &reqwest::Client,
    base_url: &str,
    mut exited: watch::Receiver<bool>,
    timeout: Duration,
) -> Readiness {
    let url = format!("{base_url}/health");
    let deadline = Instant::now() + timeout;
    loop {
        if *exited.borrow() {
            return Readiness::Exited;
        }
        let response = http.get(&url).timeout(Duration::from_secs(2)).send().await;
        if response.is_ok_and(|response| response.status() == reqwest::StatusCode::OK) {
            return Readiness::Ready;
        }
        if Instant::now() >= deadline {
            return Readiness::TimedOut;
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_millis(200)) => {}
            _ = exited.changed() => {}
        }
    }
}

fn collect_output(
    stream: impl AsyncRead + Unpin + Send + 'static,
    log: Arc<StdMutex<VecDeque<String>>>,
) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stream);
        let mut line = Vec::new();
        // Reads raw bytes so a non-UTF-8 line cannot stop the drain and
        // block the server on a full pipe.
        while reader
            .read_until(b'\n', &mut line)
            .await
            .is_ok_and(|n| n > 0)
        {
            let text = String::from_utf8_lossy(&line).trim_end().to_string();
            line.clear();
            if text.is_empty() {
                continue;
            }
            tracing::trace!(target: "llama_server", "{text}");
            let mut log = log.lock().unwrap_or_else(|error| error.into_inner());
            if log.len() == LOG_LINES {
                log.pop_front();
            }
            log.push_back(text);
        }
    });
}

fn log_lines(log: &StdMutex<VecDeque<String>>) -> Vec<String> {
    log.lock()
        .unwrap_or_else(|error| error.into_inner())
        .iter()
        .cloned()
        .collect()
}

fn start_failure_message(lines: &[String]) -> String {
    let detail = lines
        .iter()
        .rev()
        .find(|line| line.to_ascii_lowercase().contains("error"))
        .or_else(|| lines.last());
    match detail {
        Some(detail) => format!("The built-in model server stopped while starting: {detail}"),
        None => "The built-in model server stopped while starting.".to_string(),
    }
}

fn free_port() -> std::io::Result<u16> {
    Ok(std::net::TcpListener::bind("127.0.0.1:0")?
        .local_addr()?
        .port())
}

fn new_api_key() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// On Linux the kernel ends the server when the app dies, even by SIGKILL.
/// macOS has no equivalent: there the server sleeps when idle and the next
/// launch reaps it from the pidfile.
fn die_with_parent(command: &mut Command) {
    #[cfg(target_os = "linux")]
    {
        let parent = std::process::id() as libc::pid_t;
        // SAFETY: prctl and getppid are async-signal-safe and touch only
        // the child.
        unsafe {
            command.pre_exec(move || {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                // The parent died before prctl took effect.
                if libc::getppid() != parent {
                    return Err(std::io::Error::other("parent exited"));
                }
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    let _ = command;
}
