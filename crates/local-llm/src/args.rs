use std::ffi::{OsStr, OsString};
use std::path::Path;

/// llama-server reads its API key from this variable, which keeps the key
/// off the command line where other processes could read it.
pub const API_KEY_ENV: &str = "LLAMA_API_KEY";

pub struct Launch<'a> {
    pub model_path: &'a Path,
    /// The id requests name in `model`.
    pub alias: &'a str,
    pub port: u16,
    pub context: u32,
    /// The server unloads the model after this much idleness if Librelog
    /// has not stopped it first, for example after Librelog was killed.
    pub sleep_idle_seconds: u64,
}

/// The server's arguments. Never `--tools`, `--mcp-servers-*`, `--agent` or
/// `--connect`, which would let a prompt run commands or open a tunnel.
pub fn server_args(launch: &Launch<'_>) -> Vec<OsString> {
    let mut args: Vec<OsString> = Vec::new();
    let mut push = |values: &[&OsStr]| args.extend(values.iter().map(|v| v.to_os_string()));
    push(&["-m".as_ref(), launch.model_path.as_os_str()]);
    push(&["--alias".as_ref(), launch.alias.as_ref()]);
    push(&["--host".as_ref(), "127.0.0.1".as_ref()]);
    push(&["--port".as_ref(), launch.port.to_string().as_ref()]);
    push(&["-c".as_ref(), launch.context.to_string().as_ref()]);
    // One request at a time: the whole context goes to it.
    push(&["-np".as_ref(), "1".as_ref()]);
    push(&["--no-webui".as_ref(), "--offline".as_ref()]);
    // No prompt cache in RAM beyond the slot itself.
    push(&["--cache-ram".as_ref(), "0".as_ref()]);
    // Qwen3 thinks by default and would spend a 128-token title on it.
    push(&["--reasoning".as_ref(), "off".as_ref()]);
    push(&[
        "--sleep-idle-seconds".as_ref(),
        launch.sleep_idle_seconds.to_string().as_ref(),
    ]);
    args
}

/// Variables the server process may inherit. Everything else is dropped:
/// llama-server reads its options from `LLAMA_ARG_*`, so an inherited
/// `LLAMA_ARG_TOOLS` or `LLAMA_ARG_AGENT` could otherwise turn on tools.
const INHERITED: &[&str] = &[
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "USERPROFILE",
    "SYSTEMROOT",
    "WINDIR",
    "LOCALAPPDATA",
    "APPDATA",
];

pub fn server_environment(
    inherited: impl IntoIterator<Item = (OsString, OsString)>,
    api_key: &str,
) -> Vec<(OsString, OsString)> {
    let mut env: Vec<(OsString, OsString)> = inherited
        .into_iter()
        .filter(|(name, _)| {
            name.to_str().is_some_and(|name| {
                INHERITED
                    .iter()
                    .any(|allowed| allowed.eq_ignore_ascii_case(name))
            })
        })
        .collect();
    env.push((API_KEY_ENV.into(), api_key.into()));
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_listens_locally_without_tools_thinking_or_a_key_in_argv() {
        let args = server_args(&Launch {
            model_path: Path::new("/models/llm/Qwen3-4B-Q4_K_M.gguf"),
            alias: "qwen3-4b",
            port: 41234,
            context: 16_384,
            sleep_idle_seconds: 360,
        });
        let args: Vec<&str> = args.iter().map(|arg| arg.to_str().unwrap()).collect();
        let value = |flag: &str| {
            let index = args.iter().position(|arg| *arg == flag).unwrap();
            args[index + 1]
        };
        assert_eq!(value("-m"), "/models/llm/Qwen3-4B-Q4_K_M.gguf");
        assert_eq!(value("--host"), "127.0.0.1");
        assert_eq!(value("--port"), "41234");
        assert_eq!(value("-c"), "16384");
        assert_eq!(value("-np"), "1");
        assert_eq!(value("--reasoning"), "off");
        assert_eq!(value("--cache-ram"), "0");
        assert!(args.contains(&"--no-webui") && args.contains(&"--offline"));
        for forbidden in [
            "--tools",
            "--mcp",
            "--agent",
            "--connect",
            "--api-key",
            "-ag",
        ] {
            assert!(
                !args.iter().any(|arg| arg.starts_with(forbidden)),
                "{forbidden}"
            );
        }
    }

    // An inherited LLAMA_ARG_TOOLS=all would give prompts a shell.
    #[test]
    fn inherited_llama_options_do_not_reach_the_server() {
        let env = server_environment(
            [
                ("PATH".into(), "/usr/bin".into()),
                ("LLAMA_ARG_TOOLS".into(), "all".into()),
                ("LLAMA_ARG_HOST".into(), "0.0.0.0".into()),
                ("LLAMA_API_KEY".into(), "inherited".into()),
                ("SystemRoot".into(), "C:\\Windows".into()),
            ],
            "per-launch",
        );
        let env: Vec<(&str, &str)> = env
            .iter()
            .map(|(k, v)| (k.to_str().unwrap(), v.to_str().unwrap()))
            .collect();
        assert_eq!(
            env,
            [
                ("PATH", "/usr/bin"),
                ("SystemRoot", "C:\\Windows"),
                ("LLAMA_API_KEY", "per-launch"),
            ]
        );
    }
}
