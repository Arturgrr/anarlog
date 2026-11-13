//! The narration: the microphone for the whole capture, written to
//! `audio.wav` (16 kHz mono 16-bit) so that its sample 0 is the capture's
//! start.
//!
//! The microphone opens just before the screen recording starts, and its
//! frames carry no timestamps. Each frame's arrival on the host clock bounds
//! when its first sample was heard: `arrival − samples so far / rate` is never
//! earlier than the true start of sample 0, and is closest to it for the frame
//! delivered with the least delay. [`Aligner`] keeps the lowest such bound
//! over the first second of frames, then pads with silence or drops samples so
//! that the file starts at the capture's `started_host_ns`. What it cannot see
//! is the input latency before a frame reaches the process (the device's and
//! the resampler's), which makes the speech land that much late, typically
//! 10–30 ms, plus the drift between the microphone's clock and the host's over
//! a long recording (tens of ms over 20 minutes).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use tokio_util::sync::CancellationToken;

use crate::Error;

pub const SAMPLE_RATE: u32 = 16_000;
const CHUNK_SIZE: usize = 320;
/// The native layer stops at 20 minutes from the capture's start; this only
/// bounds a microphone left open by a host that lost track. Counted from the
/// start once it is known, from opening the microphone until then.
const MAX_SECONDS: u64 = 20 * 60 + 30;
/// Frames observed before the start bound is trusted: a second of 20 ms frames.
const OBSERVATIONS: usize = 50;

/// The host clock: `mach_absolute_time` in nanoseconds on macOS, the clock of
/// the native layer's `started_host_ns`.
pub trait Clock: Send + Sync + 'static {
    fn now_ns(&self) -> u64;
}

pub struct HostClock;

impl Clock for HostClock {
    #[cfg(target_os = "macos")]
    fn now_ns(&self) -> u64 {
        let mut now = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        // CLOCK_UPTIME_RAW is mach_absolute_time in nanoseconds.
        unsafe { libc::clock_gettime(libc::CLOCK_UPTIME_RAW, &mut now) };
        (now.tv_sec as u64)
            .saturating_mul(1_000_000_000)
            .saturating_add(now.tv_nsec as u64)
    }

    #[cfg(not(target_os = "macos"))]
    fn now_ns(&self) -> u64 {
        use std::sync::OnceLock;
        static EPOCH: OnceLock<std::time::Instant> = OnceLock::new();
        EPOCH
            .get_or_init(std::time::Instant::now)
            .elapsed()
            .as_nanos() as u64
    }
}

/// How many samples to put before or take off the recording's head.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shift {
    Pad(u64),
    Trim(u64),
}

/// The shift that makes a recording whose sample 0 was heard at `first_ns`
/// start at `start_ns`.
pub fn shift(first_ns: u64, start_ns: u64, rate: u32) -> Shift {
    let samples = |ns: u64| (u128::from(ns) * u128::from(rate) / 1_000_000_000) as u64;
    if first_ns <= start_ns {
        Shift::Trim(samples(start_ns - first_ns))
    } else {
        Shift::Pad(samples(first_ns - start_ns))
    }
}

/// Turns the microphone's frames into samples aligned to the capture's
/// start. Pure: the caller passes each frame's arrival time.
pub struct Aligner {
    rate: u32,
    received: u64,
    observations: usize,
    first_ns: Option<u64>,
    start_ns: Option<u64>,
    state: State,
}

enum State {
    /// Until the start and the bound are known.
    Buffering(Vec<f32>),
    /// Dropping the head that came before the start.
    Skipping(u64),
    Passing,
}

impl Aligner {
    pub fn new(rate: u32) -> Self {
        Self {
            rate,
            received: 0,
            observations: 0,
            first_ns: None,
            start_ns: None,
            state: State::Buffering(Vec::new()),
        }
    }

    /// The capture started at `ns` on the host clock.
    pub fn set_start(&mut self, ns: u64) {
        self.start_ns.get_or_insert(ns);
    }

    /// A frame arrived at `arrival_ns`; returns the samples ready to write.
    pub fn push(&mut self, arrival_ns: u64, samples: &[f32]) -> Vec<f32> {
        self.received += samples.len() as u64;
        if self.observations < OBSERVATIONS {
            let heard = u128::from(self.received) * 1_000_000_000 / u128::from(self.rate);
            let bound = u64::try_from(u128::from(arrival_ns).saturating_sub(heard)).unwrap_or(0);
            self.first_ns = Some(self.first_ns.map_or(bound, |first| first.min(bound)));
            self.observations += 1;
        }
        match &mut self.state {
            State::Buffering(buffer) => {
                buffer.extend_from_slice(samples);
                if self.observations >= OBSERVATIONS && self.start_ns.is_some() {
                    self.align()
                } else {
                    Vec::new()
                }
            }
            State::Skipping(_) | State::Passing => self.pass(samples),
        }
    }

    /// The end of the recording: what is still held, aligned as well as the
    /// frames so far allow. `None` when the capture never started.
    pub fn finish(&mut self) -> Option<Vec<f32>> {
        self.start_ns?;
        Some(match self.state {
            State::Buffering(_) => self.align(),
            _ => Vec::new(),
        })
    }

    fn align(&mut self) -> Vec<f32> {
        let (Some(start), State::Buffering(buffer)) = (
            self.start_ns,
            std::mem::replace(&mut self.state, State::Passing),
        ) else {
            return Vec::new();
        };
        let first = self.first_ns.unwrap_or(start);
        match shift(first, start, self.rate) {
            Shift::Pad(n) => {
                let mut out = vec![0.0; n as usize];
                out.extend_from_slice(&buffer);
                out
            }
            Shift::Trim(n) => {
                self.state = State::Skipping(n);
                self.pass(&buffer)
            }
        }
    }

    fn pass(&mut self, samples: &[f32]) -> Vec<f32> {
        if let State::Skipping(left) = &mut self.state {
            let skip = (*left).min(samples.len() as u64);
            *left -= skip;
            if *left == 0 {
                self.state = State::Passing;
            }
            return samples[skip as usize..].to_vec();
        }
        samples.to_vec()
    }
}

/// What a finished narration left.
#[derive(Clone, Debug)]
pub struct Narrated {
    pub path: PathBuf,
    /// Samples in the file, silence padding included.
    pub samples: u32,
}

/// The microphone recording to `audio.wav` while a capture runs.
pub struct Narration {
    cancellation: CancellationToken,
    start: Arc<Mutex<Option<u64>>>,
    keep: Arc<std::sync::atomic::AtomicBool>,
    task: tauri::async_runtime::JoinHandle<Result<Narrated, Error>>,
}

impl Narration {
    pub fn start(
        audio: Arc<dyn anlg_audio::AudioProvider>,
        device: Option<String>,
        path: PathBuf,
        clock: Arc<dyn Clock>,
    ) -> Result<Self, Error> {
        let stream = audio
            .open_mic_capture(device, SAMPLE_RATE, CHUNK_SIZE)
            .map_err(|error| Error::Microphone(error.to_string()))?;
        let cancellation = CancellationToken::new();
        let start = Arc::new(Mutex::new(None));
        let keep = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let task = tauri::async_runtime::spawn({
            let cancellation = cancellation.clone();
            let start = start.clone();
            let keep = keep.clone();
            async move {
                let result = record(stream, &path, &cancellation, start, clock).await;
                // A stream that ended or failed by itself, or the deadline,
                // leaves the file finished; only `stop` or `cancel` decides
                // whether it stays.
                cancellation.cancelled().await;
                let keep = keep.load(std::sync::atomic::Ordering::SeqCst);
                if result.is_err() || !keep {
                    let _ = std::fs::remove_file(&path);
                }
                result.and_then(|narrated| {
                    if keep {
                        Ok(narrated)
                    } else {
                        Err(Error::Cancelled)
                    }
                })
            }
        });
        Ok(Self {
            cancellation,
            start,
            keep,
            task,
        })
    }

    /// The capture started at `ns` on the host clock: sample 0 of the file.
    pub fn begin_at(&self, ns: u64) {
        *self.start.lock().unwrap_or_else(|e| e.into_inner()) = Some(ns);
    }

    pub async fn stop(self) -> Result<Narrated, Error> {
        self.keep.store(true, std::sync::atomic::Ordering::SeqCst);
        self.cancellation.cancel();
        self.task
            .await
            .map_err(|error| Error::Microphone(error.to_string()))?
    }

    /// Stops and deletes the file.
    pub async fn cancel(self) {
        self.cancellation.cancel();
        let _ = self.task.await;
    }
}

async fn record(
    mut stream: anlg_audio::CaptureStream,
    path: &Path,
    cancellation: &CancellationToken,
    start: Arc<Mutex<Option<u64>>>,
    clock: Arc<dyn Clock>,
) -> Result<Narrated, Error> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec).map_err(wav)?;
    let mut aligner = Aligner::new(SAMPLE_RATE);
    let max = std::time::Duration::from_secs(MAX_SECONDS);
    let deadline = tokio::time::sleep(max);
    tokio::pin!(deadline);
    let mut started = false;
    loop {
        tokio::select! {
            _ = cancellation.cancelled() => break,
            _ = &mut deadline => break,
            next = stream.next() => {
                let frame = match next {
                    Some(Ok(frame)) => frame,
                    Some(Err(error)) => {
                        tracing::warn!(%error, "annotate microphone stream failed");
                        break;
                    }
                    None => {
                        tracing::warn!("annotate microphone stream ended");
                        break;
                    }
                };
                let arrival = clock.now_ns();
                if let Some(ns) = *start.lock().unwrap_or_else(|e| e.into_inner()) {
                    aligner.set_start(ns);
                    if !started {
                        started = true;
                        deadline.as_mut().reset(tokio::time::Instant::now() + max);
                    }
                }
                let ready = aligner.push(arrival, &frame.preferred_mic());
                write(&mut writer, &ready)?;
            }
        }
    }
    drop(stream);
    let known = |start: &Mutex<Option<u64>>| *start.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(ns) = known(&start) {
        aligner.set_start(ns);
    } else if !cancellation.is_cancelled() {
        // The stream ended before the capture started: its start, if it
        // comes, still aligns what was heard.
        cancellation.cancelled().await;
        if let Some(ns) = known(&start) {
            aligner.set_start(ns);
        }
    }
    let rest = aligner.finish().ok_or(Error::Cancelled)?;
    write(&mut writer, &rest)?;
    let samples = writer.len();
    writer.finalize().map_err(wav)?;
    Ok(Narrated {
        path: path.to_path_buf(),
        samples,
    })
}

fn wav(error: hound::Error) -> Error {
    Error::Microphone(error.to_string())
}

fn write<W: std::io::Write + std::io::Seek>(
    writer: &mut hound::WavWriter<W>,
    samples: &[f32],
) -> Result<(), Error> {
    for sample in samples {
        writer
            .write_sample((sample.clamp(-1.0, 1.0) * f32::from(i16::MAX)) as i16)
            .map_err(wav)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 20 ms frames of `value`, the first `jitter` late by the given ns.
    fn feed(aligner: &mut Aligner, heard_at: u64, frames: usize, late: &[u64]) -> Vec<f32> {
        let mut out = Vec::new();
        for i in 0..frames {
            let ends = heard_at + (i as u64 + 1) * 20_000_000;
            let delay = late.get(i).copied().unwrap_or(3_000_000);
            out.extend(aligner.push(ends + delay, &[i as f32; CHUNK_SIZE]));
        }
        out
    }

    #[test]
    fn audio_heard_before_the_capture_started_is_trimmed_to_its_start() {
        // Sample 0 heard at 1.000 s; the capture starts at 1.250 s.
        let mut aligner = Aligner::new(SAMPLE_RATE);
        aligner.set_start(1_250_000_000);
        let mut out = feed(
            &mut aligner,
            1_000_000_000,
            60,
            &[9_000_000, 2_000_000, 7_000_000],
        );
        out.extend(aligner.finish().unwrap());
        // 250 ms = 4,000 samples dropped, give or take the 2 ms best delivery.
        let dropped = 60 * CHUNK_SIZE - out.len();
        assert!((3_960..=4_000).contains(&dropped), "dropped {dropped}");
        // What remains starts inside frame 12 (240–260 ms).
        assert_eq!(out[0], 12.0);
    }

    #[test]
    fn audio_that_began_after_the_capture_is_padded_with_silence() {
        // The capture started at 1.000 s; the microphone's sample 0 at 1.100 s.
        let mut aligner = Aligner::new(SAMPLE_RATE);
        aligner.set_start(1_000_000_000);
        let mut out = feed(&mut aligner, 1_100_000_000, 60, &[]);
        out.extend(aligner.finish().unwrap());
        let silence = out.iter().take_while(|s| **s == 0.0).count() - CHUNK_SIZE;
        // 100 ms is 1,600 samples, plus the 3 ms delivery delay counted as late.
        assert!((1_600..=1_650).contains(&silence), "silence {silence}");
        assert_eq!(out.len() - silence, 60 * CHUNK_SIZE);
    }

    #[test]
    fn a_short_recording_still_aligns_and_a_capture_that_never_started_writes_nothing() {
        let mut aligner = Aligner::new(SAMPLE_RATE);
        assert!(feed(&mut aligner, 0, 5, &[]).is_empty());
        aligner.set_start(0);
        let out = aligner.finish().unwrap();
        assert_eq!(out.len(), 5 * CHUNK_SIZE + 48);

        let mut never = Aligner::new(SAMPLE_RATE);
        feed(&mut never, 0, 5, &[]);
        assert!(never.finish().is_none());
    }

    #[test]
    fn the_shift_is_counted_in_samples() {
        assert_eq!(
            shift(1_000_000_000, 1_500_000_000, 16_000),
            Shift::Trim(8_000)
        );
        assert_eq!(
            shift(1_500_000_000, 1_000_000_000, 16_000),
            Shift::Pad(8_000)
        );
        assert_eq!(shift(5, 5, 16_000), Shift::Trim(0));
    }

    /// A microphone that delivers `frames` 20 ms frames, then ends.
    struct Ending(usize);

    impl anlg_audio::AudioProvider for Ending {
        fn open_capture(
            &self,
            _: anlg_audio::CaptureConfig,
        ) -> Result<anlg_audio::CaptureStream, anlg_audio::Error> {
            unreachable!()
        }
        fn open_speaker_capture(
            &self,
            _: u32,
            _: usize,
        ) -> Result<anlg_audio::CaptureStream, anlg_audio::Error> {
            unreachable!()
        }
        fn open_mic_capture(
            &self,
            _: Option<String>,
            _: u32,
            chunk: usize,
        ) -> Result<anlg_audio::CaptureStream, anlg_audio::Error> {
            let frame = anlg_audio::CaptureFrame {
                raw_mic: Arc::from(vec![0.1_f32; chunk]),
                raw_speaker: Arc::from([]),
                aec_mic: None,
            };
            Ok(anlg_audio::CaptureStream::new(
                futures_util::stream::unfold(self.0, move |left| {
                    let frame = frame.clone();
                    async move {
                        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                        (left > 0).then(|| (Ok(frame), left - 1))
                    }
                }),
            ))
        }
        fn default_device_name(&self) -> String {
            "mic".into()
        }
        fn list_mic_devices(&self) -> Vec<String> {
            Vec::new()
        }
        fn play_silence(&self) -> std::sync::mpsc::Sender<()> {
            std::sync::mpsc::channel().0
        }
        fn play_bytes(&self, _: &'static [u8]) -> std::sync::mpsc::Sender<()> {
            std::sync::mpsc::channel().0
        }
        fn probe_mic(&self, _: Option<String>) -> Result<(), anlg_audio::Error> {
            Ok(())
        }
        fn probe_speaker(&self) -> Result<(), anlg_audio::Error> {
            Ok(())
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_microphone_that_ends_mid_recording_keeps_what_it_heard_for_stop() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("audio.wav");
        let started = HostClock.now_ns();
        let narration = Narration::start(
            Arc::new(Ending(10)),
            None,
            path.clone(),
            Arc::new(HostClock),
        )
        .unwrap();
        narration.begin_at(started);
        // The ten frames and the end of the stream come well before the stop.
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let narrated = narration.stop().await.unwrap();
        let wav = hound::WavReader::open(&narrated.path).unwrap();
        assert!(
            wav.duration() >= 10 * CHUNK_SIZE as u32 / 2,
            "{}",
            wav.duration()
        );
        assert_eq!(wav.duration(), narrated.samples);
    }
}
