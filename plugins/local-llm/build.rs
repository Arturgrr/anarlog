const COMMANDS: &[&str] = &[
    "runtime_status",
    "list_models",
    "models_dir",
    "download_model",
    "cancel_download",
    "delete_model",
    "is_model_downloading",
    "ensure_server",
    "stop_server",
    "server_state",
];

fn main() {
    // Debug builds look for the server that `cargo xtask prepare-binaries`
    // leaves in apps/desktop/src-tauri/binaries/, which carries the triple.
    println!(
        "cargo:rustc-env=LOCAL_LLM_TARGET_TRIPLE={}",
        std::env::var("TARGET").expect("cargo sets TARGET")
    );
    tauri_plugin::Builder::new(COMMANDS).build();
}
