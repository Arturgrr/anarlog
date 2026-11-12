//! End to end against a real llama-server, when `LIBRELOG_LLAMA_SERVER`
//! names its binary and `LIBRELOG_LLAMA_TEST_MODEL` a small GGUF chat model.
//! Without them these tests do nothing. CI runs them with the pinned upstream
//! Ubuntu build and the pinned stories260K model.
#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use local_llm::{Endpoint, LaunchRequest, ServerConfig, ServerManager, ServerState};

const MODEL_ID: &str = "test-model";
const CONTEXT: u32 = 2048;
const PARENT_ENV: &str = "LIBRELOG_LLAMA_TEST_PARENT";

fn setup() -> Option<(PathBuf, PathBuf)> {
    let binary = std::env::var_os("LIBRELOG_LLAMA_SERVER")?;
    let model = std::env::var_os("LIBRELOG_LLAMA_TEST_MODEL")?;
    Some((PathBuf::from(binary), PathBuf::from(model)))
}

fn manager(binary: &Path, state_dir: &Path, idle_stop_after: Duration) -> ServerManager {
    let mut config = ServerConfig::new(binary.to_path_buf(), state_dir.to_path_buf());
    config.idle_stop_after = idle_stop_after;
    config.idle_poll_interval = Duration::from_millis(250);
    config.start_timeout = Duration::from_secs(120);
    ServerManager::new(config, |state| eprintln!("state: {state:?}"))
}

fn request(model: &Path) -> LaunchRequest {
    LaunchRequest {
        model: MODEL_ID.to_string(),
        model_path: model.to_path_buf(),
        context: CONTEXT,
    }
}

fn chat(
    endpoint: &Endpoint,
    key: Option<&str>,
    body: serde_json::Value,
) -> reqwest::RequestBuilder {
    let request = reqwest::Client::builder()
        .no_proxy()
        .build()
        .unwrap()
        .post(format!("{}/chat/completions", endpoint.base_url))
        .json(&body);
    match key {
        Some(key) => request.bearer_auth(key),
        None => request,
    }
}

fn alive(pid: u32) -> bool {
    // A zombie counts as gone; /proc/<pid>/stat shows it as Z.
    match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        Ok(stat) => !stat
            .rsplit_once(')')
            .is_some_and(|(_, rest)| rest.trim_start().starts_with('Z')),
        // SAFETY: signal 0 only checks that the process exists.
        Err(_) => unsafe { libc::kill(pid as libc::pid_t, 0) == 0 },
    }
}

fn server_pid(state_dir: &Path) -> Option<u32> {
    let record: serde_json::Value =
        serde_json::from_slice(&std::fs::read(state_dir.join("llama-server.pid")).ok()?).ok()?;
    record["pid"].as_u64().map(|pid| pid as u32)
}

#[tokio::test]
async fn real_server_serves_the_app_and_stops_when_idle() {
    let Some((binary, model)) = setup() else {
        eprintln!("LIBRELOG_LLAMA_SERVER / LIBRELOG_LLAMA_TEST_MODEL unset; skipping");
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let manager = manager(&binary, dir.path(), Duration::from_secs(3));

    let started = Instant::now();
    let endpoint = manager.ensure(request(&model)).await.unwrap();
    eprintln!("ready in {:?} at {}", started.elapsed(), endpoint.base_url);
    let pid = server_pid(dir.path()).expect("pidfile written");
    assert!(alive(pid));

    // The same request reuses the running server.
    let again = manager.ensure(request(&model)).await.unwrap();
    assert_eq!(again, endpoint);

    let unauthorized = chat(
        &endpoint,
        None,
        serde_json::json!({"model": MODEL_ID, "messages": [{"role": "user", "content": "Hi"}]}),
    )
    .send()
    .await
    .unwrap();
    assert_eq!(unauthorized.status(), 401);

    let started = Instant::now();
    let stream = chat(
        &endpoint,
        Some(&endpoint.api_key),
        serde_json::json!({
            "model": MODEL_ID,
            "stream": true,
            "max_tokens": 32,
            "messages": [{"role": "user", "content": "Say hello in one short sentence."}],
        }),
    )
    .send()
    .await
    .unwrap();
    assert_eq!(stream.status(), 200);
    let body = stream.text().await.unwrap();
    let deltas: Vec<serde_json::Value> = body
        .lines()
        .filter_map(|line| line.strip_prefix("data: "))
        .filter(|data| *data != "[DONE]")
        .map(|data| serde_json::from_str(data).unwrap())
        .collect();
    let text: String = deltas
        .iter()
        .filter_map(|chunk| chunk["choices"][0]["delta"]["content"].as_str())
        .collect();
    assert!(body.trim_end().ends_with("data: [DONE]"), "{body}");
    assert!(!text.is_empty());
    eprintln!("streamed in {:?}: {text:?}", started.elapsed());

    let started = Instant::now();
    let structured = chat(
        &endpoint,
        Some(&endpoint.api_key),
        serde_json::json!({
            "model": MODEL_ID,
            "max_tokens": 64,
            "messages": [{"role": "user", "content": "Is the sky blue? Answer yes or no."}],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "answer",
                    "strict": true,
                    "schema": {
                        "type": "object",
                        "properties": {"answer": {"type": "string", "enum": ["yes", "no"]}},
                        "required": ["answer"],
                        "additionalProperties": false,
                    },
                },
            },
        }),
    )
    .send()
    .await
    .unwrap()
    .json::<serde_json::Value>()
    .await
    .unwrap();
    let content = structured["choices"][0]["message"]["content"]
        .as_str()
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_str(content).unwrap();
    assert!(["yes", "no"].contains(&parsed["answer"].as_str().unwrap()));
    eprintln!("structured in {:?}: {content}", started.elapsed());

    // Titles get 128 tokens; a model that thinks first would spend them all
    // on reasoning and return no title.
    let started = Instant::now();
    let title = chat(
        &endpoint,
        Some(&endpoint.api_key),
        serde_json::json!({
            "model": MODEL_ID,
            "max_tokens": 128,
            "messages": [
                {"role": "system", "content": "Write a short title for this meeting note. Reply with the title only."},
                {"role": "user", "content": "We agreed the Q3 budget, hired two engineers and moved the launch to October."},
            ],
        }),
    )
    .send()
    .await
    .unwrap()
    .json::<serde_json::Value>()
    .await
    .unwrap();
    let message = &title["choices"][0]["message"];
    let title_text = message["content"].as_str().unwrap_or_default();
    assert!(!title_text.trim().is_empty(), "{title}");
    assert!(!title_text.contains("<think>"), "{title_text}");
    assert!(
        message["reasoning_content"]
            .as_str()
            .is_none_or(str::is_empty),
        "{message}"
    );
    eprintln!(
        "title in {:?}: {title_text:?}, {} tokens/s",
        started.elapsed(),
        title["timings"]["predicted_per_second"]
    );

    // The app sends the whole transcript at once; past the context the
    // server answers 400 with a type the app turns into "too long".
    let overflow = chat(
        &endpoint,
        Some(&endpoint.api_key),
        serde_json::json!({
            "model": MODEL_ID,
            "stream": true,
            "messages": [{"role": "user", "content": "word ".repeat(4 * CONTEXT as usize)}],
        }),
    )
    .send()
    .await
    .unwrap();
    assert_eq!(overflow.status(), 400);
    let error: serde_json::Value = overflow.json().await.unwrap();
    assert_eq!(
        error["error"]["type"], "exceed_context_size_error",
        "{error}"
    );
    eprintln!("overflow: {}", error["error"]["message"]);

    let idle_since = Instant::now();
    for _ in 0..80 {
        if manager.state() == ServerState::Stopped {
            break;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    assert_eq!(manager.state(), ServerState::Stopped);
    for _ in 0..20 {
        if !alive(pid) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(!alive(pid));
    assert!(server_pid(dir.path()).is_none());
    eprintln!("idle stop after {:?}", idle_since.elapsed());
}

// A server left behind by a killed app is stopped at the next launch, but
// only if it runs this app's binary.
#[tokio::test]
async fn next_launch_reaps_a_stale_server() {
    let Some((binary, model)) = setup() else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let mut orphan = std::process::Command::new(&binary)
        .arg("-m")
        .arg(&model)
        .args([
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "-c",
            "512",
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    std::fs::write(
        dir.path().join("llama-server.pid"),
        serde_json::json!({"pid": orphan.id(), "exe": binary}).to_string(),
    )
    .unwrap();

    let other = manager(
        Path::new("/opt/elsewhere/llama-server"),
        dir.path(),
        Duration::from_secs(60),
    );
    assert_eq!(other.reap_stale(), None);
    assert!(orphan.try_wait().unwrap().is_none());
    std::fs::write(
        dir.path().join("llama-server.pid"),
        serde_json::json!({"pid": orphan.id(), "exe": binary}).to_string(),
    )
    .unwrap();

    let next = manager(&binary, dir.path(), Duration::from_secs(60));
    assert_eq!(next.reap_stale(), Some(orphan.id()));
    let status = orphan.wait().unwrap();
    eprintln!("stale server exited: {status}");
    assert!(!dir.path().join("llama-server.pid").exists());
}

// Linux ends the server with the app, even when the app is killed; macOS has
// no such hook and relies on the server's idle sleep and the reaping above.
#[cfg(target_os = "linux")]
#[tokio::test]
async fn killing_the_app_leaves_no_server() {
    let Some((binary, model)) = setup() else {
        return;
    };

    if let Some(state_dir) = std::env::var_os(PARENT_ENV) {
        // The stand-in for the app: start a server, then wait to be killed.
        let manager = manager(&binary, Path::new(&state_dir), Duration::from_secs(600));
        manager.ensure(request(&model)).await.unwrap();
        std::fs::write(Path::new(&state_dir).join("ready"), b"").unwrap();
        tokio::time::sleep(Duration::from_secs(300)).await;
        return;
    }

    let dir = tempfile::tempdir().unwrap();
    let mut app = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "killing_the_app_leaves_no_server", "--nocapture"])
        .env(PARENT_ENV, dir.path())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(120);
    while !dir.path().join("ready").exists() {
        assert!(
            Instant::now() < deadline,
            "the app never started its server"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let pid = server_pid(dir.path()).unwrap();
    assert!(alive(pid));

    app.kill().unwrap();
    app.wait().unwrap();
    for _ in 0..50 {
        if !alive(pid) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(!alive(pid), "server {pid} outlived the app");
}
