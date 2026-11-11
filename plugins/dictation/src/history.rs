use std::path::{Component, Path, PathBuf};

use crate::Error;

const DIRECTORY: &str = "dictation-history";
const EXTENSION: &str = ".wav";
const PARTIAL_EXTENSION: &str = ".wav.partial";
/// Five minutes of 32-bit mono audio at 16 kHz, with room to spare.
const MAX_RECORDING_BYTES: u64 = 64 * 1024 * 1024;

pub(crate) fn directory<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, Error> {
    use tauri::Manager;
    Ok(app.path().app_data_dir()?.join(DIRECTORY))
}

/// Copies a finished recording into the history as 16-bit `<id>.wav` and
/// returns that file name. `discard` must confirm the recorder produced the
/// file (it deletes the temporary one); when it refuses, the copy goes too.
pub(crate) fn keep(
    directory: &Path,
    id: &str,
    file_path: String,
    discard: impl FnOnce(String) -> Result<(), Error>,
) -> Result<String, Error> {
    let name = file_name(id)?;
    let source = PathBuf::from(&file_path);
    if !is_temporary_recording(&source) {
        return Err(Error::UnknownRecording);
    }
    create_private_directory(directory)?;
    let target = directory.join(&name);
    let partial = directory.join(format!("{id}{PARTIAL_EXTENSION}"));
    if let Err(error) = convert(&source, &partial).and_then(|()| {
        std::fs::rename(&partial, &target).map_err(|error| Error::Recording(error.to_string()))
    }) {
        let _ = std::fs::remove_file(&partial);
        return Err(error);
    }
    match discard(file_path) {
        // Released by the recorder but not deleted: the kept copy is still
        // the dictation's own.
        Ok(()) | Err(Error::Recording(_)) => Ok(name),
        Err(error) => {
            let _ = std::fs::remove_file(&target);
            Err(error)
        }
    }
}

/// The kept recording `name`, for transcribing it again.
pub(crate) fn resolve(directory: &Path, name: &str) -> Result<PathBuf, Error> {
    validate(name)?;
    let path = directory.join(name);
    match std::fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_file() => Ok(path),
        _ => Err(Error::UnknownRecording),
    }
}

pub(crate) fn delete(directory: &Path, names: &[String]) -> Result<(), Error> {
    for name in names {
        validate(name)?;
    }
    for name in names {
        remove(&directory.join(name))?;
    }
    Ok(())
}

/// Deletes every kept recording no entry refers to any more, including what
/// an interrupted [`keep`] left behind. Other files are left alone.
pub(crate) fn prune(directory: &Path, referenced: &[String]) -> Result<(), Error> {
    for name in referenced {
        validate(name)?;
    }
    let entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(Error::Recording(error.to_string())),
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let partial = name.strip_suffix(PARTIAL_EXTENSION).is_some_and(is_id);
        let unreferenced = validate(name).is_ok() && !referenced.iter().any(|kept| kept == name);
        if partial || unreferenced {
            remove(&entry.path())?;
        }
    }
    Ok(())
}

fn file_name(id: &str) -> Result<String, Error> {
    if is_id(id) {
        Ok(format!("{id}{EXTENSION}"))
    } else {
        Err(Error::UnknownRecording)
    }
}

fn validate(name: &str) -> Result<(), Error> {
    match name.strip_suffix(EXTENSION) {
        Some(id) if is_id(id) => Ok(()),
        _ => Err(Error::UnknownRecording),
    }
}

fn is_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn is_temporary_recording(path: &Path) -> bool {
    path.is_absolute()
        && path.extension().is_some_and(|extension| extension == "wav")
        && path.starts_with(std::env::temp_dir())
        && path.components().all(|component| {
            matches!(
                component,
                Component::Prefix(_) | Component::RootDir | Component::Normal(_)
            )
        })
        && std::fs::symlink_metadata(path)
            .is_ok_and(|metadata| metadata.is_file() && metadata.len() <= MAX_RECORDING_BYTES)
}

fn convert(source: &Path, target: &Path) -> Result<(), Error> {
    let failed = |error: hound::Error| Error::Recording(error.to_string());
    let mut reader = hound::WavReader::open(source).map_err(failed)?;
    let input = reader.spec();
    let spec = hound::WavSpec {
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
        ..input
    };
    let mut writer = hound::WavWriter::create(target, spec).map_err(failed)?;
    restrict(target, 0o600)?;
    match (input.sample_format, input.bits_per_sample) {
        (hound::SampleFormat::Float, 32) => {
            for sample in reader.samples::<f32>() {
                let sample = sample.map_err(failed)?.clamp(-1.0, 1.0);
                writer
                    .write_sample((sample * f32::from(i16::MAX)).round() as i16)
                    .map_err(failed)?;
            }
        }
        (hound::SampleFormat::Int, 16) => {
            for sample in reader.samples::<i16>() {
                writer
                    .write_sample(sample.map_err(failed)?)
                    .map_err(failed)?;
            }
        }
        _ => return Err(Error::Recording("unsupported recording format".into())),
    }
    writer.finalize().map_err(failed)
}

fn create_private_directory(directory: &Path) -> Result<(), Error> {
    std::fs::create_dir_all(directory).map_err(|error| Error::Recording(error.to_string()))?;
    restrict(directory, 0o700)
}

#[cfg(unix)]
fn restrict(path: &Path, mode: u32) -> Result<(), Error> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
        .map_err(|error| Error::Recording(error.to_string()))
}

#[cfg(not(unix))]
fn restrict(_path: &Path, _mode: u32) -> Result<(), Error> {
    Ok(())
}

fn remove(path: &Path) -> Result<(), Error> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(Error::Recording(error.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recording(directory: &Path) -> String {
        let path = directory.join("librelog-dictation-test.wav");
        let mut writer = hound::WavWriter::create(
            &path,
            hound::WavSpec {
                channels: 1,
                sample_rate: 16_000,
                bits_per_sample: 32,
                sample_format: hound::SampleFormat::Float,
            },
        )
        .unwrap();
        for sample in [0.0_f32, 0.5, -0.5, 2.0] {
            writer.write_sample(sample).unwrap();
        }
        writer.finalize().unwrap();
        path.to_string_lossy().into_owned()
    }

    fn names(directory: &Path) -> Vec<String> {
        let mut names: Vec<_> = std::fs::read_dir(directory)
            .map(|entries| {
                entries
                    .flatten()
                    .map(|entry| entry.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    #[test]
    fn only_a_recording_the_recorder_releases_is_kept() {
        let temporary = tempfile::tempdir().unwrap();
        let history = temporary.path().join("history");
        let source = recording(temporary.path());

        for (id, path) in [
            ("../escape", source.clone()),
            ("entry", "relative.wav".to_string()),
            (
                "entry",
                format!("{}/../{}", temporary.path().display(), "x.wav"),
            ),
        ] {
            let result = keep(&history, id, path, |_| unreachable!());
            assert!(matches!(result, Err(Error::UnknownRecording)));
        }
        let refused = keep(&history, "entry", source.clone(), |_| {
            Err(Error::UnknownRecording)
        });
        assert!(matches!(refused, Err(Error::UnknownRecording)));
        assert!(names(&history).is_empty());
        assert!(Path::new(&source).exists());

        let kept = keep(&history, "entry", source.clone(), |path| {
            std::fs::remove_file(path).map_err(|error| Error::Recording(error.to_string()))
        })
        .unwrap();
        assert_eq!(kept, "entry.wav");
        assert!(!Path::new(&source).exists());
        let mut reader = hound::WavReader::open(history.join(&kept)).unwrap();
        assert_eq!(reader.spec().bits_per_sample, 16);
        let samples: Vec<i16> = reader.samples().map(Result::unwrap).collect();
        assert_eq!(samples, [0, 16_384, -16_384, i16::MAX]);
    }

    #[test]
    fn kept_audio_is_only_read_or_deleted_inside_the_history_directory() {
        let temporary = tempfile::tempdir().unwrap();
        let history = temporary.path().join("history");
        std::fs::create_dir_all(&history).unwrap();
        for name in ["kept.wav", "gone.wav", "crashed.wav.partial", "notes.txt"] {
            std::fs::write(history.join(name), b"audio").unwrap();
        }
        std::fs::write(temporary.path().join("app.wav"), b"outside").unwrap();

        for name in ["../app.wav", "nested/kept.wav", "kept.txt", ".wav", ""] {
            assert!(resolve(&history, name).is_err());
            assert!(delete(&history, &[name.to_string()]).is_err());
            assert!(prune(&history, &[name.to_string()]).is_err());
        }
        assert!(resolve(&history, "missing.wav").is_err());
        assert_eq!(
            resolve(&history, "kept.wav").unwrap(),
            history.join("kept.wav")
        );

        prune(&history, &["kept.wav".to_string()]).unwrap();
        assert_eq!(names(&history), ["kept.wav", "notes.txt"]);
        delete(
            &history,
            &["kept.wav".to_string(), "missing.wav".to_string()],
        )
        .unwrap();
        assert_eq!(names(&history), ["notes.txt"]);
        assert!(temporary.path().join("app.wav").exists());
    }
}
