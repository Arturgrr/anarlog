// Full-resolution frames from a finished recording, for key frames. Hex
// (MIT, © 2026 Christopher Langton) decodes them the same way in
// `crates/capture/helper/Media.swift`, clamping each time into the movie.

import AVFoundation
import CoreGraphics
import Foundation

enum AnnotateFrames {
  static let durationTimeout: Double = 10
  static let frameTimeout: Double = 15

  /// Blocks while it decodes; off the main thread.
  static func extract(_ request: AnnotateExtractRequest) -> Result<
    AnnotateExtractReply, AnnotateFailure
  > {
    guard request.video.hasPrefix("/"), request.dir.hasPrefix("/") else {
      return .failure(AnnotateFailure(.invalidArgument, "video and dir must be absolute paths"))
    }
    guard FileManager.default.fileExists(atPath: request.video) else {
      return .failure(AnnotateFailure(.invalidArgument, "\(request.video) does not exist"))
    }
    let dir = URL(fileURLWithPath: request.dir, isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    } catch {
      return .failure(AnnotateFailure(.io, "could not create \(request.dir): \(error)"))
    }
    let asset = AVURLAsset(url: URL(fileURLWithPath: request.video))
    guard let durationMs = duration(of: asset) else {
      return .failure(AnnotateFailure(.extract, "could not read the movie's length"))
    }
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    // The frame on screen at that time, not a nearby key frame.
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero

    var reply = AnnotateExtractReply(frames: [], failed: [])
    for tMs in request.timesMs {
      let videoMs = AnnotateFiles.videoTime(
        tMs: tMs, offsetMs: request.videoOffsetMs ?? 0, durationMs: durationMs)
      let url = dir.appendingPathComponent(AnnotateFiles.frameName(tMs: tMs))
      switch image(generator, at: videoMs) {
      case .success(let (image, actualMs)):
        if AnnotateImages.write(image, to: url, type: AnnotateImages.png) {
          reply.frames.append(
            AnnotateFrame(tMs: tMs, videoMs: videoMs, actualMs: actualMs, path: url.path))
        } else {
          reply.failed.append(AnnotateFrameFailure(tMs: tMs, message: "could not write the PNG"))
        }
      case .failure(let failure):
        reply.failed.append(AnnotateFrameFailure(tMs: tMs, message: failure.message))
      }
    }
    if reply.frames.isEmpty, let first = reply.failed.first {
      return .failure(AnnotateFailure(.extract, first.message))
    }
    return .success(reply)
  }

  private static func duration(of asset: AVURLAsset) -> Int? {
    let loaded = AnnotateLocked<CMTime?>(nil)
    let done = DispatchSemaphore(value: 0)
    Task {
      loaded.set(try? await asset.load(.duration))
      done.signal()
    }
    guard done.wait(timeout: .now() + durationTimeout) == .success,
      let duration = loaded.get(), duration.isValid, duration.seconds.isFinite,
      duration.seconds > 0
    else {
      return nil
    }
    return Int((duration.seconds * 1000).rounded(.down))
  }

  private static func image(_ generator: AVAssetImageGenerator, at videoMs: Int) -> Result<
    (CGImage, Int), AnnotateFailure
  > {
    let answer = AnnotateLocked<(image: CGImage?, actual: CMTime, error: Error?)?>(nil)
    let done = DispatchSemaphore(value: 0)
    let time = CMTime(value: CMTimeValue(videoMs), timescale: 1000)
    generator.generateCGImageAsynchronously(for: time) { image, actual, error in
      answer.set((image, actual, error))
      done.signal()
    }
    guard done.wait(timeout: .now() + frameTimeout) == .success, let reply = answer.get() else {
      return .failure(AnnotateFailure(.timeout, "no frame at \(videoMs) ms in 15 s"))
    }
    guard let image = reply.image else {
      let detail = reply.error.map { "\($0)" } ?? "no image"
      return .failure(AnnotateFailure(.extract, "no frame at \(videoMs) ms: \(detail)"))
    }
    var actualMs = videoMs
    if reply.actual.isValid && reply.actual.seconds.isFinite {
      actualMs = Int((reply.actual.seconds * 1000).rounded())
    }
    return .success((image, actualMs))
  }
}
