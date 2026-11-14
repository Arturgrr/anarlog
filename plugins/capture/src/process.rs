//! Running a short command with a deadline.

use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anlg_capture_core::hotkeys::Error;

fn drain(stream: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut stream) = stream {
            let _ = stream.read_to_end(&mut bytes);
        }
        bytes
    })
}

/// Runs `program` with `input` on its stdin and returns its stdout. One that
/// has not finished `within` is killed. The child is always waited for; a
/// failure carries its stderr.
#[cfg_attr(not(feature = "system-shortcuts"), allow(dead_code))]
pub fn run(
    program: &str,
    args: &[&str],
    input: Option<Vec<u8>>,
    within: Duration,
) -> Result<Vec<u8>, Error> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let writer = child
        .stdin
        .take()
        .zip(input)
        .map(|(mut stdin, input)| std::thread::spawn(move || stdin.write_all(&input)));
    let stdout = drain(child.stdout.take());
    let stderr = drain(child.stderr.take());
    let deadline = Instant::now() + within;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.into());
            }
        }
    };
    let written = writer.map(|writer| writer.join());
    let stdout = stdout.join().unwrap_or_default();
    let stderr = String::from_utf8_lossy(&stderr.join().unwrap_or_default())
        .trim()
        .to_owned();
    let Some(status) = status else {
        return Err(Error::Command(format!(
            "{program} did not finish within {} s and was stopped",
            within.as_secs()
        )));
    };
    if !status.success() {
        return Err(Error::Command(format!(
            "{program} failed ({status}): {stderr}"
        )));
    }
    if let Some(Ok(Err(error))) = written {
        return Err(Error::Command(format!(
            "{program} did not take its input: {error}"
        )));
    }
    Ok(stdout)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn a_hung_command_is_stopped_and_a_failed_one_reports_its_stderr() {
        let started = Instant::now();
        let error = run("sleep", &["30"], None, Duration::from_millis(200)).unwrap_err();
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(error.to_string().contains("did not finish"), "{error}");

        let error = run(
            "sh",
            &["-c", "cat >/dev/null; echo no such domain >&2; exit 3"],
            Some(b"<plist/>".to_vec()),
            Duration::from_secs(5),
        )
        .unwrap_err();
        assert!(error.to_string().contains("no such domain"), "{error}");
        assert_eq!(
            run(
                "sh",
                &["-c", "cat"],
                Some(b"xml".to_vec()),
                Duration::from_secs(5)
            )
            .unwrap(),
            b"xml"
        );
    }
}
