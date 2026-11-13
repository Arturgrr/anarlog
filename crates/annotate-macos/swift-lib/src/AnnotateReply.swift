// What crosses to Rust: the reply envelope, structured errors, the
// requests and results as JSON, and the pure arithmetic behind their
// times and file names.

import Foundation

enum AnnotateErrorCode: String, Codable {
  case unsupported
  case mainThread = "main_thread"
  case busy
  case notRecording = "not_recording"
  case permission
  case noDisplay = "no_display"
  case invalidArgument = "invalid_argument"
  case io
  case stream
  case recording
  case timeout
  case extract
  case `internal`
}

struct AnnotateFailure: Error, Codable, Equatable {
  var code: AnnotateErrorCode
  var message: String

  init(_ code: AnnotateErrorCode, _ message: String) {
    self.code = code
    self.message = message
  }
}

/// Every entry point answers `{"ok": true, "value": …}` or
/// `{"ok": false, "error": {"code", "message"}}`.
enum AnnotateReply {
  private struct Success<Value: Encodable>: Encodable {
    var ok = true
    var value: Value
  }

  private struct Failure: Encodable {
    var ok = false
    var error: AnnotateFailure
  }

  static func encoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return encoder
  }

  static func ok<Value: Encodable>(_ value: Value) -> String {
    text(Success(value: value))
  }

  static func failure(_ failure: AnnotateFailure) -> String {
    text(Failure(error: failure))
  }

  static func from<Value: Encodable>(_ result: Result<Value, AnnotateFailure>) -> String {
    switch result {
    case .success(let value): return ok(value)
    case .failure(let error): return failure(error)
    }
  }

  private static func text<Body: Encodable>(_ body: Body) -> String {
    guard let data = try? encoder().encode(body), let text = String(data: data, encoding: .utf8)
    else {
      return #"{"ok":false,"error":{"code":"internal","message":"could not encode the reply"}}"#
    }
    return text
  }

  static func decode<Request: Decodable>(_ type: Request.Type, from json: String) -> Result<
    Request, AnnotateFailure
  > {
    do {
      return .success(try JSONDecoder().decode(type, from: Data(json.utf8)))
    } catch {
      return .failure(AnnotateFailure(.invalidArgument, "unreadable request: \(error)"))
    }
  }
}

/// `{}` for calls that return nothing.
struct AnnotateNothing: Codable, Equatable {}

struct AnnotateStartRequest: Decodable {
  /// An absolute directory; created when missing. `recording.mp4` must not
  /// be in it yet.
  var dir: String
  /// The capsule's words in the host's language; English when absent.
  var labels: AnnotateLabels?
}

/// The capsule's texts. A missing one stays English.
struct AnnotateLabels: Decodable, Equatable {
  var discardQuestion = "Discard?"
  var discard = "Discard"
  var keep = "Keep"

  enum CodingKeys: String, CodingKey {
    case discardQuestion = "discard_question"
    case discard
    case keep
  }

  init() {}

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let english = AnnotateLabels()
    discardQuestion =
      try container.decodeIfPresent(String.self, forKey: .discardQuestion)
      ?? english.discardQuestion
    discard = try container.decodeIfPresent(String.self, forKey: .discard) ?? english.discard
    keep = try container.decodeIfPresent(String.self, forKey: .keep) ?? english.keep
  }
}

struct AnnotateDisplayInfo: Codable, Equatable {
  var id: UInt32
  var widthPt: Double
  var heightPt: Double
  var scale: Double
  var widthPx: Int
  var heightPx: Int
  /// The movie's size: the long edge at most 2,560 px.
  var videoWidth: Int
  var videoHeight: Int

  enum CodingKeys: String, CodingKey {
    case id
    case widthPt = "width_pt"
    case heightPt = "height_pt"
    case scale
    case widthPx = "width_px"
    case heightPx = "height_px"
    case videoWidth = "video_width"
    case videoHeight = "video_height"
  }
}

struct AnnotateStartReply: Codable, Equatable {
  /// `mach_absolute_time()` at the recording's start: the zero of every
  /// `t_ms`.
  var startedHostTicks: UInt64
  var startedHostNs: UInt64
  var startedWallMs: Int64
  var display: AnnotateDisplayInfo

  enum CodingKeys: String, CodingKey {
    case startedHostTicks = "started_host_ticks"
    case startedHostNs = "started_host_ns"
    case startedWallMs = "started_wall_ms"
    case display
  }
}

struct AnnotateFrontApp: Codable, Equatable {
  var name: String?
  var bundleId: String?
  /// The front window's title, read from the window list (Screen
  /// Recording lets it be read); nil when it has none.
  var windowTitle: String?

  enum CodingKeys: String, CodingKey {
    case name
    case bundleId = "bundle_id"
    case windowTitle = "window_title"
  }
}

struct AnnotateCandidate: Codable, Equatable {
  var tMs: Int
  var path: String

  enum CodingKeys: String, CodingKey {
    case tMs = "t_ms"
    case path
  }
}

struct AnnotateStopResult: Codable, Equatable {
  var videoPath: String
  var startedHostTicks: UInt64
  var startedHostNs: UInt64
  var startedWallMs: Int64
  /// From the start to the stop.
  var durationMs: Int
  /// Where the movie's first frame falls on the recording's clock; nil
  /// when no frame was seen.
  var videoOffsetMs: Int?
  /// The movie's own length, from the recording output.
  var videoDurationMs: Int?
  var display: AnnotateDisplayInfo
  var frontApp: AnnotateFrontApp
  var candidates: [AnnotateCandidate]
  var strokes: [AnnotateStroke]
  /// `stop`, `max_duration` or `stream_error`.
  var endedBy: String
  /// Problems that left a usable movie.
  var warnings: [String]

  enum CodingKeys: String, CodingKey {
    case videoPath = "video_path"
    case startedHostTicks = "started_host_ticks"
    case startedHostNs = "started_host_ns"
    case startedWallMs = "started_wall_ms"
    case durationMs = "duration_ms"
    case videoOffsetMs = "video_offset_ms"
    case videoDurationMs = "video_duration_ms"
    case display
    case frontApp = "front_app"
    case candidates
    case strokes
    case endedBy = "ended_by"
    case warnings
  }
}

struct AnnotateExtractRequest: Decodable {
  var video: String
  /// The stop result's `video_offset_ms`; 0 when absent.
  var videoOffsetMs: Int?
  /// Times on the recording's clock, as strokes and candidates use.
  var timesMs: [Int]
  var dir: String

  enum CodingKeys: String, CodingKey {
    case video
    case videoOffsetMs = "video_offset_ms"
    case timesMs = "times_ms"
    case dir
  }
}

struct AnnotateFrame: Codable, Equatable {
  var tMs: Int
  /// The time asked of the movie.
  var videoMs: Int
  /// The decoded frame's own time in the movie.
  var actualMs: Int
  var path: String

  enum CodingKeys: String, CodingKey {
    case tMs = "t_ms"
    case videoMs = "video_ms"
    case actualMs = "actual_ms"
    case path
  }
}

struct AnnotateFrameFailure: Codable, Equatable {
  var tMs: Int
  var message: String

  enum CodingKeys: String, CodingKey {
    case tMs = "t_ms"
    case message
  }
}

struct AnnotateExtractReply: Codable, Equatable {
  var frames: [AnnotateFrame]
  var failed: [AnnotateFrameFailure]
}

enum AnnotateFiles {
  static let video = "recording.mp4"
  static let candidates = "candidates"

  /// A candidate's file: its time from the start, zero-padded so names
  /// sort by time (eight digits hold 27 hours).
  static func candidateName(tMs: Int) -> String {
    String(format: "%08ld.jpg", max(0, tMs))
  }

  static func frameName(tMs: Int) -> String {
    String(format: "frame-%08ld.png", max(0, tMs))
  }

  /// Where `tMs` on the recording's clock falls in a movie that starts
  /// `offsetMs` in and lasts `durationMs`: never before its start nor past
  /// its last millisecond.
  static func videoTime(tMs: Int, offsetMs: Int, durationMs: Int) -> Int {
    min(max(tMs - offsetMs, 0), max(durationMs - 1, 0))
  }
}

/// `mach_absolute_time` arithmetic: the clock of ScreenCaptureKit's frame
/// times, Core Audio's host times and `CACurrentMediaTime`.
struct AnnotateTimebase: Equatable {
  var numer: UInt32
  var denom: UInt32

  func nanoseconds(_ ticks: UInt64) -> UInt64 {
    let (numer, denom) = (UInt64(numer), UInt64(max(denom, 1)))
    let whole = ticks / denom
    let (scaled, overflow) = whole.multipliedReportingOverflow(by: numer)
    if overflow { return UInt64.max }
    return scaled + (ticks % denom) * numer / denom
  }

  /// Milliseconds from `from` to `to`, rounded down; 0 for a time before.
  func milliseconds(from: UInt64, to: UInt64) -> Int {
    guard to > from else { return 0 }
    return Int(min(nanoseconds(to - from) / 1_000_000, UInt64(Int.max)))
  }

  func seconds(_ ticks: UInt64) -> Double {
    Double(nanoseconds(ticks)) / 1e9
  }
}
