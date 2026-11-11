//! What this process changed that would stay changed if it died: a muted or
//! lowered output. Hex only waits for restoration when it quits; a crash,
//! a force quit or a power cut would still leave the output quiet, so each
//! process keeps a small file of its pending restores, which the next run
//! applies in [`crate::recover`]. Media and sleep need none: resuming media
//! long after a crash would surprise, and the OS releases sleep prevention
//! with the process.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct Record {
    pub(crate) pid: u32,
    pub(crate) muted: Option<Muted>,
    pub(crate) ducked: Option<Ducked>,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct Muted {
    pub(crate) output: String,
    /// Set when the output was muted by setting its volume to zero.
    pub(crate) previous_volume: Option<f32>,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct Ducked {
    pub(crate) output: String,
    pub(crate) original: Vec<f32>,
    pub(crate) volume: f32,
}

struct State {
    dir: Option<PathBuf>,
    record: Record,
}

static STATE: Mutex<State> = Mutex::new(State {
    dir: None,
    record: Record {
        pid: 0,
        muted: None,
        ducked: None,
    },
});

const PREFIX: &str = "recording-environment-";

pub(crate) fn set_dir(dir: PathBuf) {
    let mut state = STATE.lock().unwrap_or_else(|error| error.into_inner());
    state.dir = Some(dir);
    state.record.pid = std::process::id();
    save(&state);
}

pub(crate) fn remember_mute(muted: Muted) {
    update(|record| record.muted = Some(muted));
}

pub(crate) fn forget_mute() {
    update(|record| record.muted = None);
}

pub(crate) fn remember_duck(ducked: Ducked) {
    update(|record| record.ducked = Some(ducked));
}

pub(crate) fn forget_duck() {
    update(|record| record.ducked = None);
}

fn update(change: impl FnOnce(&mut Record)) {
    let mut state = STATE.lock().unwrap_or_else(|error| error.into_inner());
    change(&mut state.record);
    save(&state);
}

fn save(state: &State) {
    let Some(dir) = &state.dir else {
        return;
    };
    let path = record_path(dir, state.record.pid);
    let result = if state.record.muted.is_none() && state.record.ducked.is_none() {
        match std::fs::remove_file(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            other => other,
        }
    } else {
        write(&path, &state.record)
    };
    if let Err(error) = result {
        tracing::warn!(%error, "could not record the audio to restore after a crash");
    }
}

fn record_path(dir: &Path, pid: u32) -> PathBuf {
    dir.join(format!("{PREFIX}{pid}.json"))
}

fn write(path: &Path, record: &Record) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, serde_json::to_vec(record)?)?;
    std::fs::rename(&temporary, path)
}

/// Records left in `dir` by processes that are gone; a record of a process
/// still running, such as another build of the app, is its own.
pub(crate) fn leftovers(dir: &Path) -> Vec<(PathBuf, Record)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let own = std::process::id();
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(PREFIX))
        })
        .filter_map(|path| {
            let record: Record = serde_json::from_slice(&std::fs::read(&path).ok()?).ok()?;
            (record.pid != own && !alive(record.pid)).then_some((path, record))
        })
        .collect()
}

#[cfg(unix)]
fn alive(pid: u32) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    // SAFETY: Signal 0 only checks that the process exists.
    if unsafe { libc::kill(pid, 0) } == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(windows)]
fn alive(pid: u32) -> bool {
    use windows::Win32::Foundation::{CloseHandle, ERROR_ACCESS_DENIED, STILL_ACTIVE};
    use windows::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    // SAFETY: The handle is checked, queried and closed once.
    unsafe {
        match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(process) => {
                let mut code = 0;
                let running =
                    GetExitCodeProcess(process, &mut code).is_ok() && code == STILL_ACTIVE.0 as u32;
                let _ = CloseHandle(process);
                running
            }
            Err(error) => error.code() == ERROR_ACCESS_DENIED.to_hresult(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_records_of_processes_that_are_gone_are_left_over() {
        let dir = tempfile::tempdir().unwrap();
        let gone = Record {
            pid: u32::MAX - 1,
            muted: Some(Muted {
                output: "speakers".into(),
                previous_volume: Some(0.6),
            }),
            ducked: None,
        };
        let running = Record {
            pid: std::process::id(),
            ..gone.clone()
        };
        write(&record_path(dir.path(), gone.pid), &gone).unwrap();
        write(&record_path(dir.path(), running.pid), &running).unwrap();
        std::fs::write(dir.path().join("unrelated.json"), b"{}").unwrap();

        let leftovers = leftovers(dir.path());
        assert_eq!(
            leftovers,
            [(record_path(dir.path(), gone.pid), gone)],
            "a live process keeps its record"
        );
    }
}
