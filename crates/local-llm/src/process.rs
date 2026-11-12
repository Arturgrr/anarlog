//! The server's pidfile, and stopping a server Librelog started, including
//! one left running by an earlier Librelog that was killed.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use sysinfo::{
    Pid, ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, Signal, System, UpdateKind,
};

const PIDFILE: &str = "llama-server.pid";

#[derive(serde::Serialize, serde::Deserialize)]
struct PidRecord {
    pid: u32,
    exe: PathBuf,
}

pub(crate) fn pidfile(state_dir: &Path) -> PathBuf {
    state_dir.join(PIDFILE)
}

pub(crate) fn write_pidfile(state_dir: &Path, pid: u32, exe: &Path) {
    let record = PidRecord {
        pid,
        exe: exe.to_path_buf(),
    };
    let result = std::fs::create_dir_all(state_dir).and_then(|()| {
        std::fs::write(
            pidfile(state_dir),
            serde_json::to_vec(&record).unwrap_or_default(),
        )
    });
    if let Err(error) = result {
        tracing::warn!(%error, "llama_server_pidfile_write_failed");
    }
}

/// Removes the pidfile if it still names `pid`.
pub(crate) fn clear_pidfile(state_dir: &Path, pid: u32) {
    let path = pidfile(state_dir);
    let Ok(bytes) = std::fs::read(&path) else {
        return;
    };
    if serde_json::from_slice::<PidRecord>(&bytes).is_ok_and(|record| record.pid == pid) {
        let _ = std::fs::remove_file(path);
    }
}

/// Stops the server an earlier run of this app left behind, when the
/// pidfile names a live process running `binary`. A process that is not
/// this app's server, such as one that reused the pid, or a server of
/// another Librelog installation, is left alone. Returns the pid stopped.
pub fn reap_stale_server(state_dir: &Path, binary: &Path) -> Option<u32> {
    let path = pidfile(state_dir);
    let record: PidRecord = serde_json::from_slice(&std::fs::read(&path).ok()?).ok()?;
    let stopped = same_executable(&record.exe, binary)
        && stop_process(record.pid, binary, Duration::from_secs(3));
    let _ = std::fs::remove_file(path);
    if stopped {
        tracing::info!(pid = record.pid, "llama_server_stale_reaped");
        Some(record.pid)
    } else {
        None
    }
}

/// Asks the process to exit, then kills it after `grace`, but only when it
/// runs `binary`. Returns whether it was ours and is gone.
pub fn stop_process(pid: u32, binary: &Path, grace: Duration) -> bool {
    let pid = Pid::from_u32(pid);
    let mut system = System::new();
    let refresh = |system: &mut System| {
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[pid]),
            true,
            ProcessRefreshKind::nothing().with_exe(UpdateKind::Always),
        );
    };
    refresh(&mut system);
    let Some(process) = system.process(pid) else {
        return false;
    };
    if !process
        .exe()
        .is_some_and(|exe| same_executable(exe, binary))
    {
        return false;
    }
    if process.kill_with(Signal::Term) != Some(true) {
        process.kill();
    }

    let deadline = Instant::now() + grace;
    loop {
        refresh(&mut system);
        match system.process(pid) {
            None => return true,
            Some(process) if process.status() == ProcessStatus::Zombie => return true,
            Some(process) if Instant::now() >= deadline => {
                process.kill();
                return true;
            }
            Some(_) => std::thread::sleep(Duration::from_millis(50)),
        }
    }
}

fn same_executable(a: &Path, b: &Path) -> bool {
    // Linux names a replaced binary "<path> (deleted)".
    let strip = |path: &Path| -> PathBuf {
        let text = path.to_string_lossy();
        let text = text.strip_suffix(" (deleted)").unwrap_or(&text);
        let path = PathBuf::from(text);
        std::fs::canonicalize(&path).unwrap_or(path)
    };
    strip(a) == strip(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    // A pid reused by an unrelated program must survive the stale-server
    // sweep at launch.
    #[cfg(unix)]
    #[test]
    fn reaping_leaves_a_process_running_another_program() {
        let dir = tempfile::tempdir().unwrap();
        let mut sleeper = std::process::Command::new("sleep")
            .arg("30")
            .spawn()
            .unwrap();
        write_pidfile(dir.path(), sleeper.id(), Path::new("/usr/bin/sleep"));

        let reaped = reap_stale_server(dir.path(), Path::new("/opt/librelog/llama-server"));

        assert_eq!(reaped, None);
        assert!(sleeper.try_wait().unwrap().is_none());
        assert!(!pidfile(dir.path()).exists());
        sleeper.kill().unwrap();
        sleeper.wait().unwrap();
    }
}
