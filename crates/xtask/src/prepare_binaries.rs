use anyhow::{Context, Result};
use std::{env, fs, path::PathBuf, process::Command};
use xshell::{Shell, cmd};

pub(crate) fn prepare_binaries() -> Result<()> {
    let root_dir = crate::repo_root();
    let src_tauri = root_dir.join("apps/desktop/src-tauri");
    let binaries_dir = src_tauri.join("binaries");
    let embedded_cli_dir = src_tauri.join("resources").join("cli");

    let triple = match env::var("TAURI_ENV_TARGET_TRIPLE") {
        Ok(v) => v,
        Err(_) => rustc_host_triple()?,
    };
    let ext = if triple.contains("windows") {
        ".exe"
    } else {
        ""
    };
    let cargo = env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned());

    let sh = Shell::new()?;
    sh.change_dir(&src_tauri);
    let target_dir = target_dir(&sh, &cargo)?;
    cmd!(
        sh,
        "{cargo} build --release --target {triple} -p chrome-native-host"
    )
    .run()?;

    fs::create_dir_all(&binaries_dir).context("create binaries/")?;

    let src = target_dir
        .join(&triple)
        .join("release")
        .join(format!("librelog-chrome-native-host{ext}"));
    let dst = binaries_dir.join(format!("librelog-chrome-native-host-{triple}{ext}"));
    fs::copy(&src, &dst).with_context(|| format!("copy {} -> {}", src.display(), dst.display()))?;

    println!("prepare-binaries: binaries/librelog-chrome-native-host-{triple}{ext}");

    cmd!(
        sh,
        "{cargo} build --release --target {triple} -p librelog-cli"
    )
    .run()?;

    fs::create_dir_all(&embedded_cli_dir).context("create resources/cli/")?;

    let src = target_dir
        .join(&triple)
        .join("release")
        .join(format!("librelog{ext}"));
    let dst = embedded_cli_dir.join(format!("librelog-cli-{triple}{ext}"));
    fs::copy(&src, &dst).with_context(|| format!("copy {} -> {}", src.display(), dst.display()))?;

    println!("prepare-binaries: resources/cli/librelog-cli-{triple}{ext}");

    crate::llama_server::prepare(&sh, &triple, &target_dir, &binaries_dir)?;
    Ok(())
}

// The desktop crate is a workspace member, so its builds land in the workspace
// target directory (or CARGO_TARGET_DIR), never in src-tauri/target.
fn target_dir(sh: &Shell, cargo: &str) -> Result<PathBuf> {
    let metadata = cmd!(sh, "{cargo} metadata --format-version 1 --no-deps")
        .quiet()
        .read()
        .context("run cargo metadata")?;
    let metadata: serde_json::Value =
        serde_json::from_str(&metadata).context("parse cargo metadata")?;
    let dir = metadata["target_directory"]
        .as_str()
        .context("cargo metadata has no target_directory")?;
    Ok(PathBuf::from(dir))
}

fn rustc_host_triple() -> Result<String> {
    let out = Command::new("rustc")
        .arg("-vV")
        .output()
        .context("run rustc -vV")?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let host_line = stdout
        .lines()
        .find(|l| l.starts_with("host:"))
        .context("no host line in rustc -vV")?;
    let triple = host_line
        .split_whitespace()
        .nth(1)
        .context("malformed host line")?;
    Ok(triple.to_owned())
}
