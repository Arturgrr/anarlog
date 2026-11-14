// Capture's files: pictures written with their pixel density, thumbnails
// of pictures and movies, a movie turned into a looping GIF frame by
// frame, and a capture put on the clipboard. Blocking calls, off the main
// thread; only the clipboard hops to it.

import AVFoundation
import AppKit
import CoreGraphics
import CoreMedia
import CoreVideo
import Foundation
import ImageIO

enum CaptureMedia {
  static let gifType = "com.compuserve.gif"
  static let loadTimeout: Double = 10
  static let frameTimeout: Double = 15

  /// Writes `image` as PNG or JPEG. Its DPI is 72 × `scale`, so a Retina
  /// shot opens at its size in points.
  static func writeImage(
    _ image: CGImage, to url: URL, format: CaptureImageFormat, quality: Double, scale: Double
  ) -> Bool {
    let type = format == .jpeg ? AnnotateImages.jpeg : AnnotateImages.png
    guard
      let destination = CGImageDestinationCreateWithURL(url as CFURL, type as CFString, 1, nil)
    else {
      return false
    }
    let dpi = 72 * (scale.isFinite && scale > 0 ? scale : 1)
    var properties: [CFString: Any] = [
      kCGImagePropertyDPIWidth: dpi, kCGImagePropertyDPIHeight: dpi,
    ]
    if format == .jpeg { properties[kCGImageDestinationLossyCompressionQuality] = quality }
    CGImageDestinationAddImage(destination, image, properties as CFDictionary)
    return CGImageDestinationFinalize(destination)
  }

  /// `image` drawn into a new `width` × `height` bitmap, smoothly.
  static func redraw(_ image: CGImage, width: Int, height: Int) -> CGImage? {
    guard width > 0, height > 0, let space = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else {
      return nil
    }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return context.makeImage()
  }

  /// `image` with its long edge at most `longEdge` pixels.
  static func shrunk(_ image: CGImage, longEdge: Int) -> CGImage? {
    let size = CaptureGeometry.fitted(width: image.width, height: image.height, longEdge: longEdge)
    if size.width == image.width && size.height == image.height { return image }
    return redraw(image, width: size.width, height: size.height)
  }

  static func createParent(of url: URL) -> AnnotateFailure? {
    let dir = url.deletingLastPathComponent()
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      return nil
    } catch {
      return AnnotateFailure(.io, "could not create \(dir.path): \(error)")
    }
  }

  static func bytes(of url: URL) -> Int {
    let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
    return (attributes?[.size] as? NSNumber)?.intValue ?? 0
  }

  static func isMovie(_ url: URL) -> Bool {
    ["mp4", "mov", "m4v"].contains(url.pathExtension.lowercased())
  }

  // MARK: Thumbnails

  static func thumbnail(_ request: CaptureThumbnailRequest) -> Result<
    CaptureThumbnailReply, AnnotateFailure
  > {
    if let problem = request.problem() { return .failure(problem) }
    let source = URL(fileURLWithPath: request.source)
    guard FileManager.default.fileExists(atPath: source.path) else {
      return .failure(AnnotateFailure(.invalidArgument, "\(request.source) does not exist"))
    }
    let picture =
      isMovie(source)
      ? movieFrame(source, longEdge: request.edge)
      : pictureThumbnail(source, longEdge: request.edge)
    guard let image = picture else {
      return .failure(AnnotateFailure(.extract, "could not read a picture from \(request.source)"))
    }
    let out = URL(fileURLWithPath: request.outPath)
    if let failure = createParent(of: out) { return .failure(failure) }
    guard AnnotateImages.write(image, to: out, type: AnnotateImages.png) else {
      return .failure(AnnotateFailure(.io, "could not write \(out.path)"))
    }
    return .success(
      CaptureThumbnailReply(path: out.path, widthPx: image.width, heightPx: image.height))
  }

  /// The first picture of a PNG, JPEG or GIF, its long edge at most
  /// `longEdge`.
  static func pictureThumbnail(_ url: URL, longEdge: Int) -> CGImage? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: longEdge,
    ]
    return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
  }

  /// A movie's first frame, its long edge at most `longEdge`.
  static func movieFrame(_ url: URL, longEdge: Int) -> CGImage? {
    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: longEdge, height: longEdge)
    let answer = AnnotateLocked<CGImage?>(nil)
    let done = DispatchSemaphore(value: 0)
    generator.generateCGImageAsynchronously(for: .zero) { image, _, _ in
      answer.set(image)
      done.signal()
    }
    guard done.wait(timeout: .now() + frameTimeout) == .success else { return nil }
    return answer.get()
  }

  // MARK: GIF

  /// Reads the movie once, front to back, and writes each planned frame
  /// as soon as it is decoded: the frame nearest each sample time.
  static func makeGif(_ request: CaptureGifRequest) -> Result<CaptureGifReply, AnnotateFailure> {
    if let problem = request.problem() { return .failure(problem) }
    let video = URL(fileURLWithPath: request.video)
    guard FileManager.default.fileExists(atPath: video.path) else {
      return .failure(AnnotateFailure(.invalidArgument, "\(request.video) does not exist"))
    }
    let asset = AVURLAsset(url: video)
    guard let movie = load(asset) else {
      return .failure(AnnotateFailure(.extract, "could not read the movie's video track"))
    }
    guard
      let plan = CaptureGifPlan.make(
        duration: movie.duration, fps: request.frameRate, maxFrames: request.frameLimit,
        width: Int(movie.size.width.rounded()), height: Int(movie.size.height.rounded()),
        maxWidth: request.widthLimit)
    else {
      return .failure(AnnotateFailure(.extract, "the movie has no length or no picture"))
    }
    let reader: AVAssetReader
    do {
      reader = try AVAssetReader(asset: asset)
    } catch {
      return .failure(AnnotateFailure(.extract, "could not read the movie: \(error)"))
    }
    let format = kCVPixelBufferPixelFormatTypeKey as String
    let settings: [String: Any] = [format: kCVPixelFormatType_32BGRA]
    let output = AVAssetReaderTrackOutput(track: movie.track, outputSettings: settings)
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else {
      return .failure(AnnotateFailure(.extract, "could not decode the movie's frames"))
    }
    reader.add(output)
    guard reader.startReading() else {
      let detail = reader.error.map { "\($0)" } ?? "no reason given"
      return .failure(AnnotateFailure(.extract, "could not start reading the movie: \(detail)"))
    }
    defer { if reader.status == .reading { reader.cancelReading() } }

    let out = URL(fileURLWithPath: request.outPath)
    if let failure = createParent(of: out) { return .failure(failure) }
    guard
      let destination = CGImageDestinationCreateWithURL(
        out as CFURL, gifType as CFString, plan.frames, nil)
    else {
      return .failure(AnnotateFailure(.io, "could not create \(out.path)"))
    }
    let loop: [CFString: Any] = [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]]
    CGImageDestinationSetProperties(destination, loop as CFDictionary)

    var written = 0
    func add(_ image: CGImage) {
      let delay = plan.delays[written]
      let frame: [CFString: Any] = [
        kCGImagePropertyGIFDictionary: [
          kCGImagePropertyGIFDelayTime: delay, kCGImagePropertyGIFUnclampedDelayTime: delay,
        ]
      ]
      CGImageDestinationAddImage(destination, image, frame as CFDictionary)
      written += 1
    }

    var previous: CaptureGifFrame?
    var firstTime: Double?
    var failure: String?
    while written < plan.frames, failure == nil {
      guard let buffer = output.copyNextSampleBuffer() else { break }
      // Each frame's decoded and scaled pictures go before the next one.
      failure = autoreleasepool { () -> String? in
        let stamp = CMSampleBufferGetPresentationTimeStamp(buffer)
        guard stamp.isValid, stamp.seconds.isFinite, CMSampleBufferGetImageBuffer(buffer) != nil
        else {
          return nil
        }
        let start = firstTime ?? stamp.seconds
        firstTime = start
        let current = CaptureGifFrame(time: stamp.seconds - start, buffer: buffer)
        while written < plan.frames, plan.times[written] <= current.time {
          let at = plan.times[written]
          // The nearer of the frame before the sample time and this one.
          let usePrevious = previous.map { at - $0.time < current.time - at } ?? false
          let chosen = usePrevious ? previous : current
          guard let image = chosen?.image(plan.width, plan.height) else {
            return "could not convert the movie's frame at \(at) s"
          }
          add(image)
        }
        previous = current
        return nil
      }
    }
    if failure == nil, reader.status == .failed {
      let detail = reader.error.map { "\($0)" } ?? "no reason given"
      failure = "the movie could not be read: \(detail)"
    }
    // Sample times past the last frame (the reader finished) show the last
    // frame.
    if failure == nil, written < plan.frames {
      if let image = previous?.image(plan.width, plan.height) {
        while written < plan.frames { add(image) }
      } else {
        failure = "the movie has no frames"
      }
    }
    if let failure {
      try? FileManager.default.removeItem(at: out)
      return .failure(AnnotateFailure(.extract, failure))
    }
    guard CGImageDestinationFinalize(destination) else {
      try? FileManager.default.removeItem(at: out)
      return .failure(AnnotateFailure(.io, "could not finish \(out.path)"))
    }
    return .success(
      CaptureGifReply(
        path: out.path, widthPx: plan.width, heightPx: plan.height, frames: plan.frames,
        fps: plan.fps, bytes: bytes(of: out)))
  }

  private struct Movie {
    var track: AVAssetTrack
    var size: CGSize
    var duration: Double
  }

  private static func load(_ asset: AVURLAsset) -> Movie? {
    let loaded = AnnotateLocked<Movie?>(nil)
    let done = DispatchSemaphore(value: 0)
    Task {
      defer { done.signal() }
      guard let track = try? await asset.loadTracks(withMediaType: .video).first,
        let size = try? await track.load(.naturalSize),
        let duration = try? await asset.load(.duration), duration.isValid,
        duration.seconds.isFinite
      else {
        return
      }
      loaded.set(Movie(track: track, size: size, duration: duration.seconds))
    }
    guard done.wait(timeout: .now() + loadTimeout) == .success else { return nil }
    return loaded.get()
  }

  // MARK: Clipboard

  /// One pasteboard item: a screenshot's PNG (a JPEG converted) and its
  /// file, a GIF's file and data, a movie's file.
  static func copy(_ request: CaptureCopyRequest) -> Result<AnnotateNothing, AnnotateFailure> {
    if let problem = request.problem() { return .failure(problem) }
    let url = URL(fileURLWithPath: request.path)
    guard FileManager.default.fileExists(atPath: url.path) else {
      return .failure(AnnotateFailure(.invalidArgument, "\(request.path) does not exist"))
    }
    let payload: (data: Data, type: NSPasteboard.PasteboardType)?
    switch request.kind {
    case .screenshot:
      guard let data = pngData(url) else {
        return .failure(AnnotateFailure(.io, "could not read \(url.path) as a picture"))
      }
      payload = (data, NSPasteboard.PasteboardType.png)
    case .gif:
      guard let data = try? Data(contentsOf: url) else {
        return .failure(AnnotateFailure(.io, "could not read \(url.path)"))
      }
      payload = (data, NSPasteboard.PasteboardType(gifType))
    case .video:
      payload = nil
    }
    let wrote = annotateOnMain { () -> Bool in
      let item = NSPasteboardItem()
      if let payload { _ = item.setData(payload.data, forType: payload.type) }
      _ = item.setString(url.absoluteString, forType: .fileURL)
      let pasteboard = NSPasteboard.general
      _ = pasteboard.clearContents()
      return pasteboard.writeObjects([item])
    }
    guard wrote else { return .failure(AnnotateFailure(.io, "could not write the clipboard")) }
    return .success(AnnotateNothing())
  }

  static func pngData(_ url: URL) -> Data? {
    if url.pathExtension.lowercased() == "png" { return try? Data(contentsOf: url) }
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
      return nil
    }
    let data = NSMutableData()
    guard
      let destination = CGImageDestinationCreateWithData(
        data as CFMutableData, AnnotateImages.png as CFString, 1, nil)
    else {
      return nil
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { return nil }
    return data as Data
  }
}

/// A decoded movie frame, drawn at the GIF's size only when a sample
/// time picks it.
private final class CaptureGifFrame {
  let time: Double
  private let buffer: CMSampleBuffer
  private var drawn: CGImage?

  init(time: Double, buffer: CMSampleBuffer) {
    self.time = time
    self.buffer = buffer
  }

  func image(_ width: Int, _ height: Int) -> CGImage? {
    if let drawn { return drawn }
    guard let pixels = CMSampleBufferGetImageBuffer(buffer) else { return nil }
    CVPixelBufferLockBaseAddress(pixels, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixels, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(pixels),
      let space = CGColorSpace(name: CGColorSpace.sRGB),
      let source = CGContext(
        data: base, width: CVPixelBufferGetWidth(pixels),
        height: CVPixelBufferGetHeight(pixels), bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(pixels), space: space,
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
          | CGBitmapInfo.byteOrder32Little.rawValue),
      let frame = source.makeImage()
    else {
      return nil
    }
    // Drawn while the buffer is locked: `frame` may still share its memory.
    drawn = CaptureMedia.redraw(frame, width: width, height: height)
    return drawn
  }
}
