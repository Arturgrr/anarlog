//! The server supervisor against a stand-in for llama-server: a small Python
//! HTTP server that takes llama-server's arguments.
#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use local_llm::{LaunchRequest, ServerConfig, ServerError, ServerManager, ServerState};

// argv: -c <mode> <count file> <llama-server args...>
// It logs its startup to stderr, as llama-server does, so a failed start
// quotes how far it got.
const STAND_IN: &str = r#"
import http.server, json, os, socketserver, sys, time
started = time.monotonic()
def log(message):
    print(f"stand-in {os.getpid()} +{time.monotonic() - started:.2f}s: {message}", file=sys.stderr, flush=True)
mode, count = sys.argv[1], sys.argv[2]
log(f"{sys.executable} in {mode} mode")
with open(count, "a") as f:
    f.write("start\n")
if mode == "crash":
    print("llama_model_load: error loading model: corrupted file", file=sys.stderr)
    sys.exit(1)
port = int(sys.argv[sys.argv.index("--port") + 1])
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def do_GET(self):
        if self.path == "/health":
            body = {"status": "ok"}
        elif self.path == "/slots":
            body = [{"id": 0, "is_processing": mode == "busy"}]
        else:
            self.send_response(404)
            self.end_headers()
            return
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
class Server(http.server.HTTPServer):
    # HTTPServer looks up its address's host name between binding and
    # listening, which can stall for many seconds on macOS. llama-server
    # makes no such lookup.
    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = "127.0.0.1", port
server = Server(("127.0.0.1", port), Handler, bind_and_activate=False)
server.server_bind()
server.server_activate()
log(f"listening on {port}")
server.serve_forever()
"#;

struct StandIn {
    dir: tempfile::TempDir,
    states: Arc<Mutex<Vec<ServerState>>>,
}

impl StandIn {
    fn new() -> Self {
        Self {
            dir: tempfile::tempdir().unwrap(),
            states: Arc::default(),
        }
    }

    fn count_file(&self) -> PathBuf {
        self.dir.path().join("starts")
    }

    fn starts(&self) -> usize {
        std::fs::read_to_string(self.count_file())
            .map(|text| text.lines().count())
            .unwrap_or(0)
    }

    fn manager(&self, mode: &str, idle_stop_after: Duration) -> ServerManager {
        let mut config = ServerConfig::new(python3(), self.dir.path().join("state"));
        config.leading_args = vec![
            "-c".into(),
            STAND_IN.into(),
            mode.into(),
            self.count_file().into(),
        ];
        config.idle_stop_after = idle_stop_after;
        config.idle_poll_interval = Duration::from_millis(100);
        config.start_timeout = Duration::from_secs(20);
        let states = self.states.clone();
        ServerManager::new(config, move |state| {
            states.lock().unwrap().push(state.clone())
        })
    }
}

fn python3() -> PathBuf {
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .map(|dir| dir.join("python3"))
        .find(|path| path.is_file())
        .expect("these tests need python3 on PATH")
}

fn request(model: &str) -> LaunchRequest {
    LaunchRequest {
        model: model.to_string(),
        model_path: Path::new("/models/none.gguf").to_path_buf(),
        context: 8192,
    }
}

// A server that dies while loading must not be restarted forever: after
// three failed starts Librelog stops trying until someone asks again.
#[tokio::test]
async fn three_failed_starts_stop_retries_until_stopped() {
    let stand_in = StandIn::new();
    let manager = stand_in.manager("crash", Duration::from_secs(300));

    for attempt in 1..=3 {
        let error = manager.ensure(request("qwen3-4b")).await.unwrap_err();
        assert!(matches!(error, ServerError::StartFailed(_)), "{error:?}");
        assert!(error.to_string().contains("corrupted file"), "{error}");
        assert!(matches!(
            manager.state(),
            ServerState::Failed { attempts, gave_up, .. } if attempts == attempt && gave_up == (attempt == 3)
        ));
    }

    let error = manager.ensure(request("qwen3-4b")).await.unwrap_err();
    assert!(matches!(error, ServerError::GaveUp(_)), "{error:?}");
    assert_eq!(stand_in.starts(), 3);

    manager.stop().await;
    assert_eq!(manager.state(), ServerState::Stopped);
    let _ = manager.ensure(request("qwen3-4b")).await.unwrap_err();
    assert_eq!(stand_in.starts(), 4);
}

// The server holds gigabytes of memory, so it stops once idle, but never
// while a slot is still generating.
#[tokio::test]
async fn idle_server_stops_but_a_busy_one_keeps_running() {
    let stand_in = StandIn::new();
    let idle = stand_in.manager("ok", Duration::from_millis(300));
    let endpoint = idle
        .ensure(request("qwen3-4b"))
        .await
        .unwrap_or_else(|error| panic!("{error} (stand-in: {})", python3().display()));
    assert!(endpoint.base_url.starts_with("http://127.0.0.1:"));
    assert_eq!(endpoint.api_key.len(), 64);
    assert!(matches!(
        idle.state(),
        ServerState::Ready { context: 8192, .. }
    ));

    wait_for(|| idle.state() == ServerState::Stopped).await;
    assert!(
        reqwest::get(format!(
            "{}/health",
            endpoint.base_url.trim_end_matches("/v1")
        ))
        .await
        .is_err()
    );

    let busy = stand_in.manager("busy", Duration::from_millis(300));
    busy.ensure(request("qwen3-4b"))
        .await
        .unwrap_or_else(|error| panic!("{error} (stand-in: {})", python3().display()));
    tokio::time::sleep(Duration::from_millis(1_500)).await;
    assert!(matches!(busy.state(), ServerState::Ready { .. }));
    busy.stop().await;
}

async fn wait_for(condition: impl Fn() -> bool) {
    for _ in 0..100 {
        if condition() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("condition not met within 10 seconds");
}
