// Records one display to an H.264 MP4 with ScreenCaptureKit's recording
// output, and samples small candidate frames beside it. The stop sequence
// follows Hex (MIT, © 2026 Christopher Langton),
// `crates/capture-core/src/session.rs` and `native.rs`: a frame handler
// stays attached for the whole recording, so removing the recording output
// never stops the stream by itself; stopping detaches the output first and
// keeps the stream running until the output reports that it finished or
// failed (stopping the stream while the output still exports can lose the
// file), and only then stops the stream, bounded because the capture
// service can stop answering. The 480 px candidates every 220 ms are Hex's
// `CANDIDATE_EDGE` and `FRAME_SAMPLE_INTERVAL`.

import AVFoundation
import CoreMedia
import CoreVideo
import Foundation
import ScreenCaptureKit

struct AnnotateRecordingPlan {
  var filter: SCContentFilter
  var videoSize: (width: Int, height: Int)
  var candidateSize: (width: Int, height: Int)
  var dir: URL
  /// `mach_absolute_time()` taken just before the stream starts.
  var anchorTicks: UInt64
  // Capture's settings; the defaults are Annotate's recording.
  /// The movie; nil for `recording.mp4` in `dir`.
  var outputURL: URL? = nil
  /// Part of the display, in its points from its top-left corner; nil for
  /// all of it.
  var sourceRect: CGRect? = nil
  var frameRate: Int32 = AnnotateRecorder.frameRate
  var showsCursor = true
  /// Annotate's 480 px candidates beside the movie.
  var samplesCandidates = true
  /// Other apps' sound, without this app's own.
  var systemAudio = false
  /// The default microphone, as its own track.
  var microphone = false

  var movieURL: URL { outputURL ?? dir.appendingPathComponent(AnnotateFiles.video) }
}

struct AnnotateRecordingOutcome {
  var videoDurationMs: Int?
  var firstFrameTicks: UInt64?
  var candidates: [AnnotateCandidate]
  var warnings: [String]
  /// Set when no usable movie is left.
  var failure: AnnotateFailure?
}

final class AnnotateRecorder: NSObject, SCStreamDelegate, SCStreamOutput,
  SCRecordingOutputDelegate
{
  static let frameRate: Int32 = 30
  static let videoLongEdge = 2560
  static let candidateLongEdge = 480
  static let candidateInterval = DispatchTimeInterval.milliseconds(220)
  static let startTimeout: Double = 10
  /// ScreenCaptureKit can take well over ten seconds to finish a long MP4.
  static let finishTimeout: Double = 60
  static let streamStopTimeout: Double = 10

  private struct State {
    var firstFrameTicks: UInt64?
    var outputDone = false
    var outputError: String?
    var streamError: String?
    var stopping = false
    var shooting = false
    var candidates: [AnnotateCandidate] = []
  }

  /// Called on a ScreenCaptureKit queue when the stream or its output
  /// stops by itself while recording.
  var onFailure: ((String) -> Void)?

  private let frameQueue = DispatchQueue(label: "librelog.annotate.frames")
  private let samplerQueue = DispatchQueue(label: "librelog.annotate.sampler")
  private let state = AnnotateLocked(State())
  private let outputDone = DispatchSemaphore(value: 0)
  /// Signalled when the recording output begins writing, or fails first.
  private let outputBegan = DispatchSemaphore(value: 0)
  private let shots = DispatchGroup()
  private var stream: SCStream?
  private var output: SCRecordingOutput?
  private var sampler: DispatchSourceTimer?
  private var plan: AnnotateRecordingPlan?

  var videoURL: URL? { plan?.movieURL }

  /// Starts the stream with the recording output attached, then the
  /// sampler. Blocks until the movie is being written (up to twice
  /// `startTimeout`); off the main thread.
  func start(_ plan: AnnotateRecordingPlan) -> AnnotateFailure? {
    self.plan = plan
    let configuration = SCStreamConfiguration()
    configuration.width = plan.videoSize.width
    configuration.height = plan.videoSize.height
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: plan.frameRate)
    configuration.showsCursor = plan.showsCursor
    configuration.queueDepth = 6
    configuration.pixelFormat = kCVPixelFormatType_32BGRA
    if let sourceRect = plan.sourceRect { configuration.sourceRect = sourceRect }
    configuration.capturesAudio = plan.systemAudio
    if plan.systemAudio { configuration.excludesCurrentProcessAudio = true }
    configuration.captureMicrophone = plan.microphone
    let stream = SCStream(filter: plan.filter, configuration: configuration, delegate: self)
    do {
      try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: frameQueue)
      // The recording output writes the sound; a stream with no handler
      // for it logs each buffer it drops.
      if plan.systemAudio {
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: frameQueue)
      }
      if plan.microphone {
        try stream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: frameQueue)
      }
    } catch {
      return AnnotateFailure(.stream, "could not add the frame handler: \(error)")
    }

    let recording = SCRecordingOutputConfiguration()
    recording.outputURL = plan.movieURL
    recording.videoCodecType = .h264
    recording.outputFileType = .mp4
    let output = SCRecordingOutput(configuration: recording, delegate: self)
    do {
      try stream.addRecordingOutput(output)
    } catch {
      removeOutputs(stream)
      return AnnotateFailure(.recording, "could not add the recording output: \(error)")
    }
    self.stream = stream
    self.output = output

    let started = AnnotateLocked<(done: Bool, error: Error?)>((false, nil))
    let ready = DispatchSemaphore(value: 0)
    stream.startCapture { error in
      started.set((true, error))
      ready.signal()
      // A start that answered after `abandon` gave up on it.
      if error == nil, self.state.get().stopping { stream.stopCapture { _ in } }
    }
    if ready.wait(timeout: .now() + Self.startTimeout) == .timedOut {
      abandon()
      return AnnotateFailure(.timeout, "ScreenCaptureKit did not start the stream in 10 s")
    }
    if let error = started.get().error {
      abandon()
      return Self.failure(error, "could not start the stream")
    }
    let began = outputBegan.wait(timeout: .now() + Self.startTimeout) == .success
    if !began || state.get().outputDone {
      let why = state.get().outputError ?? "the recording output did not start"
      abandon()
      return AnnotateFailure(.recording, why)
    }
    if plan.samplesCandidates { startSampler(plan) }
    return nil
  }

  /// Finishes the movie and stops the stream; blocks for up to about 80 s.
  /// Off the main thread. Safe to call once.
  func stop() -> AnnotateRecordingOutcome {
    let streamFailed = state.update { state -> Bool in
      state.stopping = true
      return state.streamError != nil
    }
    sampler?.cancel()
    sampler = nil
    _ = shots.wait(timeout: .now() + 2)
    guard let stream, let output, let videoURL else {
      return AnnotateRecordingOutcome(
        videoDurationMs: nil, firstFrameTicks: nil, candidates: [], warnings: [],
        failure: AnnotateFailure(.internal, "the recording never started"))
    }
    var warnings: [String] = []
    var detached = true
    do {
      try stream.removeRecordingOutput(output)
    } catch {
      // A stream the system stopped still reports its output's own result.
      detached = streamFailed
      if !streamFailed { warnings.append("could not detach the recording output: \(error)") }
    }
    var finished = waitForOutput(detached ? Self.finishTimeout : 0)
    if !finished && detached {
      warnings.append("the recording output did not finish in 60 s")
    }
    if !streamFailed {
      let stopped = DispatchSemaphore(value: 0)
      stream.stopCapture { _ in stopped.signal() }
      if stopped.wait(timeout: .now() + Self.streamStopTimeout) == .timedOut {
        warnings.append("ScreenCaptureKit did not stop the stream in 10 s")
      }
    }
    if !finished {
      finished = waitForOutput(5)
    }
    removeOutputs(stream)
    self.stream = nil
    self.output = nil

    let duration = output.recordedDuration
    var durationMs: Int?
    if duration.isValid && duration.seconds.isFinite {
      durationMs = Int((duration.seconds * 1000).rounded())
    }
    let snapshot = state.get()
    var failure: AnnotateFailure?
    let attributes = try? FileManager.default.attributesOfItem(atPath: videoURL.path)
    let size = (attributes?[.size] as? NSNumber)?.intValue ?? 0
    if size <= 0 {
      let why = snapshot.outputError ?? snapshot.streamError ?? "no movie was written"
      failure = AnnotateFailure(.recording, why)
    } else {
      if let error = snapshot.outputError { warnings.append("recording output: \(error)") }
      if let error = snapshot.streamError { warnings.append("stream: \(error)") }
      if !finished { warnings.append("the movie may be unfinished") }
    }
    return AnnotateRecordingOutcome(
      videoDurationMs: durationMs, firstFrameTicks: snapshot.firstFrameTicks,
      candidates: snapshot.candidates.sorted { $0.tMs < $1.tMs }, warnings: warnings,
      failure: failure)
  }

  private func waitForOutput(_ seconds: Double) -> Bool {
    if state.get().outputDone { return true }
    guard seconds > 0 else { return false }
    return outputDone.wait(timeout: .now() + seconds) == .success || state.get().outputDone
  }

  /// Unwinds a stream that did not start.
  private func abandon() {
    state.update { $0.stopping = true }
    if let stream {
      if let output { try? stream.removeRecordingOutput(output) }
      removeOutputs(stream)
      stream.stopCapture { _ in }
    }
    stream = nil
    output = nil
  }

  private func removeOutputs(_ stream: SCStream) {
    try? stream.removeStreamOutput(self, type: .screen)
    if plan?.systemAudio == true { try? stream.removeStreamOutput(self, type: .audio) }
    if plan?.microphone == true { try? stream.removeStreamOutput(self, type: .microphone) }
  }

  static func failure(_ error: Error?, _ what: String) -> AnnotateFailure {
    if let error = error as? SCStreamError, error.code == .userDeclined {
      return AnnotateFailure(.permission, "Screen Recording is not allowed: \(error)")
    }
    let detail = error.map { "\($0)" } ?? "no answer"
    return AnnotateFailure(.stream, "\(what): \(detail)")
  }

  // MARK: Candidates

  private func startSampler(_ plan: AnnotateRecordingPlan) {
    let configuration = SCStreamConfiguration()
    configuration.width = plan.candidateSize.width
    configuration.height = plan.candidateSize.height
    configuration.showsCursor = true
    let timer = DispatchSource.makeTimerSource(queue: samplerQueue)
    timer.schedule(
      deadline: .now(), repeating: Self.candidateInterval, leeway: .milliseconds(10))
    timer.setEventHandler { [weak self] in
      self?.shoot(plan, configuration)
    }
    sampler = timer
    timer.resume()
  }

  /// One candidate, skipped while the last one is still being taken.
  private func shoot(_ plan: AnnotateRecordingPlan, _ configuration: SCStreamConfiguration) {
    let go = state.update { state -> Bool in
      guard !state.stopping, !state.shooting else { return false }
      state.shooting = true
      return true
    }
    guard go else { return }
    let tMs = AnnotateHostClock.timebase.milliseconds(
      from: plan.anchorTicks, to: AnnotateHostClock.now())
    let url = plan.dir.appendingPathComponent(AnnotateFiles.candidates)
      .appendingPathComponent(AnnotateFiles.candidateName(tMs: tMs))
    shots.enter()
    SCScreenshotManager.captureImage(contentFilter: plan.filter, configuration: configuration) {
      image, _ in
      defer {
        self.state.update { $0.shooting = false }
        self.shots.leave()
      }
      guard let image, !self.state.get().stopping else { return }
      if AnnotateImages.write(image, to: url, type: AnnotateImages.jpeg, quality: 0.8) {
        self.state.update { $0.candidates.append(AnnotateCandidate(tMs: tMs, path: url.path)) }
      }
    }
  }

  // MARK: SCStreamOutput

  func stream(
    _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
    of type: SCStreamOutputType
  ) {
    guard type == .screen, state.get().firstFrameTicks == nil else { return }
    guard
      let attachments = CMSampleBufferGetSampleAttachmentsArray(
        sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
      let info = attachments.first,
      let raw = info[.status] as? Int,
      SCFrameStatus(rawValue: raw) == .complete
    else {
      return
    }
    let ticks = (info[.displayTime] as? NSNumber)?.uint64Value ?? AnnotateHostClock.now()
    state.update { state in
      if state.firstFrameTicks == nil { state.firstFrameTicks = ticks }
    }
  }

  // MARK: SCStreamDelegate

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    let stopping = state.update { state -> Bool in
      state.streamError = "\(error)"
      return state.stopping
    }
    if !stopping { onFailure?("the stream stopped: \(error)") }
  }

  // MARK: SCRecordingOutputDelegate

  func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
    let stopping = state.update { $0.stopping }
    finishOutput(error: "\(error)")
    if !stopping { onFailure?("the recording output failed: \(error)") }
  }

  func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
    outputBegan.signal()
  }

  func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
    finishOutput(error: nil)
  }

  private func finishOutput(error: String?) {
    let first = state.update { state -> Bool in
      guard !state.outputDone else { return false }
      state.outputDone = true
      state.outputError = error
      return true
    }
    if first {
      outputDone.signal()
      outputBegan.signal()
    }
  }
}
