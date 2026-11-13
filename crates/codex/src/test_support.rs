use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use tempfile::TempDir;

/// Writes an executable `codex` shell script into `temp_dir`.
///
/// A child process writes it. Had this process opened the file for writing,
/// a child that another test forks at that moment would inherit the
/// descriptor, and running the script would fail with "Text file busy"
/// until that child let go of it.
pub(crate) fn write_fake_codex_script(temp_dir: &TempDir, body: &str) -> PathBuf {
    let path = temp_dir.path().join("codex");
    let mut writer = Command::new("sh")
        .args(["-c", r#"cat > "$0" && chmod 755 "$0""#])
        .arg(&path)
        .stdin(Stdio::piped())
        .spawn()
        .expect("spawn fake codex writer");
    writer
        .stdin
        .take()
        .expect("fake codex writer stdin")
        .write_all(format!("#!/bin/sh\nset -eu\n{body}").as_bytes())
        .expect("write fake codex");
    assert!(writer.wait().expect("wait for fake codex writer").success());
    path
}
