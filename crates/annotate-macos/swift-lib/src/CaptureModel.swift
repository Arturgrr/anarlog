// Capture's requests, replies and events as JSON, and its lifecycle as
// plain state: one selector or recording at a time, never while Annotate
// records, the countdown, the cap and the capsule's discard question. No
// clock is read and no window touched here, so tests drive it with their
// own times.

import CoreGraphics
import Foundation

enum CaptureMode: String, Codable, Equatable {
  case area
  case window
  case fullscreen
}

enum CaptureImageFormat: String, Codable, Equatable {
  case png
  case jpeg
}

enum CaptureKind: String, Codable, Equatable {
  case screenshot
  case gif
  case video
}

/// What a selector is for: a screenshot's click without a drag in area
/// mode does nothing, a recording's takes the whole display.
enum CapturePurpose: Equatable {
  case screenshot
  case recording
}

/// The selector's, the capsule's and the cards' words; each one left out
/// stays English. The hints' English depends on the purpose.
struct CaptureLabels: Decodable, Equatable {
  var areaHint: String?
  var windowHint: String?
  var discardQuestion: String?
  var discard: String?
  var keep: String?
  var copy: String?
  var save: String?
  var show: String?
  var edit: String?
  var close: String?

  enum CodingKeys: String, CodingKey {
    case areaHint = "area_hint"
    case windowHint = "window_hint"
    case discardQuestion = "discard_question"
    case discard
    case keep
    case copy
    case save
    case show
    case edit
    case close
  }

  init() {}

  func hints(for purpose: CapturePurpose) -> CaptureHints {
    let english: String
    switch purpose {
    case .screenshot:
      english = "Drag to capture · Space for a window · Esc to cancel"
    case .recording:
      english =
        "Drag to record · Space for a window · Return for the whole screen · Esc to cancel"
    }
    return CaptureHints(
      area: areaHint ?? english,
      window: windowHint ?? "Click a window · Space for an area · Esc to cancel")
  }

  var capsule: AnnotateLabels {
    var labels = AnnotateLabels()
    if let discardQuestion { labels.discardQuestion = discardQuestion }
    if let discard { labels.discard = discard }
    if let keep { labels.keep = keep }
    return labels
  }

  var card: CaptureCardLabels {
    CaptureCardLabels(
      copy: copy ?? "Copy", save: save ?? "Save", show: show ?? "Show in Finder",
      edit: edit ?? "Edit", close: close ?? "Close")
  }
}

struct CaptureHints: Equatable {
  var area: String
  var window: String
}

struct CaptureCardLabels: Equatable {
  var copy: String
  var save: String
  var show: String
  var edit: String
  var close: String
}

/// A rectangle in display points from the display's top-left corner.
struct CaptureRect: Codable, Equatable {
  var x: Double
  var y: Double
  var width: Double
  var height: Double

  init(_ rect: CGRect) {
    x = Double(rect.minX)
    y = Double(rect.minY)
    width = Double(rect.width)
    height = Double(rect.height)
  }
}

private func captureAbsolute(_ path: String, _ name: String) -> AnnotateFailure? {
  path.hasPrefix("/") ? nil : AnnotateFailure(.invalidArgument, "\(name) must be an absolute path")
}

// MARK: Screenshot

struct CaptureScreenshotRequest: Decodable {
  var mode: CaptureMode
  var outPath: String
  var format: CaptureImageFormat?
  var jpegQuality: Double?
  var thumbnailPath: String?
  var thumbnailLongEdge: Int?
  var showCursor: Bool?
  var labels: CaptureLabels?

  enum CodingKeys: String, CodingKey {
    case mode
    case outPath = "out_path"
    case format
    case jpegQuality = "jpeg_quality"
    case thumbnailPath = "thumbnail_path"
    case thumbnailLongEdge = "thumbnail_long_edge"
    case showCursor = "show_cursor"
    case labels
  }

  var imageFormat: CaptureImageFormat { format ?? .png }
  var quality: Double { min(max(jpegQuality ?? 0.9, 0), 1) }
  var longEdge: Int { min(max(thumbnailLongEdge ?? 480, 16), 4096) }
  var cursor: Bool { showCursor ?? false }
  var hints: CaptureHints { (labels ?? CaptureLabels()).hints(for: .screenshot) }

  func problem() -> AnnotateFailure? {
    captureAbsolute(outPath, "out_path")
      ?? thumbnailPath.flatMap { captureAbsolute($0, "thumbnail_path") }
  }
}

/// A screenshot that was taken.
struct CaptureShot: Encodable, Equatable {
  var path: String
  var thumbnailPath: String?
  var widthPx: Int
  var heightPx: Int
  var scale: Double
  var kind: CaptureMode
  var displayId: UInt32
  var rect: CaptureRect
  var app: String?
  var windowTitle: String?

  enum CodingKeys: String, CodingKey {
    case status
    case path
    case thumbnailPath = "thumbnail_path"
    case widthPx = "width_px"
    case heightPx = "height_px"
    case scale
    case kind
    case displayId = "display_id"
    case rect
    case app
    case windowTitle = "window_title"
  }

  /// Every key, `null` included, as the host reads it.
  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode("captured", forKey: .status)
    try container.encode(path, forKey: .path)
    try container.encode(thumbnailPath, forKey: .thumbnailPath)
    try container.encode(widthPx, forKey: .widthPx)
    try container.encode(heightPx, forKey: .heightPx)
    try container.encode(scale, forKey: .scale)
    try container.encode(kind, forKey: .kind)
    try container.encode(displayId, forKey: .displayId)
    try container.encode(rect, forKey: .rect)
    try container.encode(app, forKey: .app)
    try container.encode(windowTitle, forKey: .windowTitle)
  }
}

/// `{"status": "captured", …}` or `{"status": "cancelled"}`.
enum CaptureOutcome<Value: Encodable & Equatable>: Encodable, Equatable {
  case done(Value)
  case cancelled

  private enum CodingKeys: String, CodingKey {
    case status
  }

  func encode(to encoder: Encoder) throws {
    switch self {
    case .done(let value):
      try value.encode(to: encoder)
    case .cancelled:
      var container = encoder.container(keyedBy: CodingKeys.self)
      try container.encode("cancelled", forKey: .status)
    }
  }
}

// MARK: Recording

struct CaptureRecordRequest: Decodable {
  var mode: CaptureMode
  var outPath: String
  var fps: Int?
  var showCursor: Bool?
  var microphone: Bool?
  var systemAudio: Bool?
  var countdownS: Int?
  var maxDurationS: Double?
  var labels: CaptureLabels?

  enum CodingKeys: String, CodingKey {
    case mode
    case outPath = "out_path"
    case fps
    case showCursor = "show_cursor"
    case microphone
    case systemAudio = "system_audio"
    case countdownS = "countdown_s"
    case maxDurationS = "max_duration_s"
    case labels
  }

  var frameRate: Int { min(max(fps ?? 30, 1), 60) }
  var cursor: Bool { showCursor ?? true }
  var countdown: Int { min(max(countdownS ?? 0, 0), 10) }
  var maxDuration: Double {
    guard let value = maxDurationS, value.isFinite, value > 0 else { return 1800 }
    return value
  }
  var hints: CaptureHints { (labels ?? CaptureLabels()).hints(for: .recording) }

  func problem() -> AnnotateFailure? {
    captureAbsolute(outPath, "out_path")
  }
}

/// A recording whose frames are being written.
struct CaptureRecordingStarted: Encodable, Equatable {
  var kind: CaptureMode
  var displayId: UInt32
  var rect: CaptureRect
  var widthPx: Int
  var heightPx: Int
  var scale: Double

  enum CodingKeys: String, CodingKey {
    case status
    case kind
    case displayId = "display_id"
    case rect
    case widthPx = "width_px"
    case heightPx = "height_px"
    case scale
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode("recording", forKey: .status)
    try container.encode(kind, forKey: .kind)
    try container.encode(displayId, forKey: .displayId)
    try container.encode(rect, forKey: .rect)
    try container.encode(widthPx, forKey: .widthPx)
    try container.encode(heightPx, forKey: .heightPx)
    try container.encode(scale, forKey: .scale)
  }
}

struct CaptureRecordResult: Codable, Equatable {
  var videoPath: String
  var durationMs: Int
  var widthPx: Int
  var heightPx: Int
  /// `stop`, `cap` or `stream_error`.
  var endedBy: String
  var warnings: [String]

  enum CodingKeys: String, CodingKey {
    case videoPath = "video_path"
    case durationMs = "duration_ms"
    case widthPx = "width_px"
    case heightPx = "height_px"
    case endedBy = "ended_by"
    case warnings
  }
}

struct CaptureStatus: Codable, Equatable {
  var phase: CapturePhase
  var elapsedMs: Int

  enum CodingKeys: String, CodingKey {
    case phase
    case elapsedMs = "elapsed_ms"
  }

  static let idle = CaptureStatus(phase: .idle, elapsedMs: 0)
}

// MARK: Media

struct CaptureGifRequest: Decodable {
  var video: String
  var outPath: String
  var fps: Double?
  var maxWidth: Int?
  var maxFrames: Int?

  enum CodingKeys: String, CodingKey {
    case video
    case outPath = "out_path"
    case fps
    case maxWidth = "max_width"
    case maxFrames = "max_frames"
  }

  var frameRate: Double { fps ?? 15 }
  var widthLimit: Int { maxWidth.map { $0 > 0 ? $0 : 720 } ?? 720 }
  var frameLimit: Int { maxFrames.map { $0 > 0 ? $0 : 900 } ?? 900 }

  func problem() -> AnnotateFailure? {
    captureAbsolute(video, "video") ?? captureAbsolute(outPath, "out_path")
  }
}

struct CaptureGifReply: Codable, Equatable {
  var path: String
  var widthPx: Int
  var heightPx: Int
  var frames: Int
  var fps: Double
  var bytes: Int

  enum CodingKeys: String, CodingKey {
    case path
    case widthPx = "width_px"
    case heightPx = "height_px"
    case frames
    case fps
    case bytes
  }
}

struct CaptureThumbnailRequest: Decodable {
  var source: String
  var outPath: String
  var longEdge: Int?

  enum CodingKeys: String, CodingKey {
    case source
    case outPath = "out_path"
    case longEdge = "long_edge"
  }

  var edge: Int { min(max(longEdge ?? 480, 16), 4096) }

  func problem() -> AnnotateFailure? {
    captureAbsolute(source, "source") ?? captureAbsolute(outPath, "out_path")
  }
}

struct CaptureThumbnailReply: Codable, Equatable {
  var path: String
  var widthPx: Int
  var heightPx: Int

  enum CodingKeys: String, CodingKey {
    case path
    case widthPx = "width_px"
    case heightPx = "height_px"
  }
}

struct CaptureCopyRequest: Decodable {
  var path: String
  var kind: CaptureKind

  func problem() -> AnnotateFailure? {
    captureAbsolute(path, "path")
  }
}

// MARK: Cards

enum CaptureCardAction: String, Codable, Equatable {
  case copy
  case save
  case edit
  case open
  case close
  case dragged
}

struct CaptureCardRequest: Decodable {
  var id: String
  var kind: CaptureKind
  var path: String
  var thumbnailPath: String?
  var displayId: UInt32?
  var durationMs: Int?
  var saved: Bool?
  var labels: CaptureLabels?

  enum CodingKeys: String, CodingKey {
    case id
    case kind
    case path
    case thumbnailPath = "thumbnail_path"
    case displayId = "display_id"
    case durationMs = "duration_ms"
    case saved
    case labels
  }

  func problem() -> AnnotateFailure? {
    if id.isEmpty { return AnnotateFailure(.invalidArgument, "id must not be empty") }
    return captureAbsolute(path, "path")
  }
}

struct CaptureCardCloseRequest: Decodable {
  var id: String?
  var all: Bool?

  func problem() -> AnnotateFailure? {
    if id == nil && all != true {
      return AnnotateFailure(.invalidArgument, "give an id or \"all\": true")
    }
    return nil
  }
}

/// A card leaves by itself after `lifetime` seconds without the pointer
/// on it; the pointer pauses its clock.
struct CaptureCardTimer: Equatable {
  static let lifetime: Double = 8

  private(set) var remaining = CaptureCardTimer.lifetime

  /// Returns whether the card's time is up.
  mutating func tick(_ seconds: Double, hovered: Bool) -> Bool {
    if !hovered && seconds.isFinite { remaining -= max(0, seconds) }
    return remaining <= 0
  }
}

// MARK: Events

/// What the host reads from `poll_events`.
struct CaptureEvent: Codable, Equatable {
  enum Kind: String, Codable {
    /// The capsule's stop: the host calls `record_stop`.
    case recordStop = "record_stop"
    /// The capsule's discard, confirmed: the host calls `record_cancel`.
    case recordDiscard = "record_discard"
    /// The recording ended by itself (`cap` or `stream_error`); the host
    /// calls `record_stop` for its result.
    case recordStopped = "record_stopped"
    case cardAction = "card_action"
  }

  var type: Kind
  var reason: String?
  var id: String?
  var action: CaptureCardAction?

  init(_ type: Kind, reason: String? = nil, id: String? = nil, action: CaptureCardAction? = nil) {
    self.type = type
    self.reason = reason
    self.id = id
    self.action = action
  }

  static func card(_ id: String, _ action: CaptureCardAction) -> CaptureEvent {
    CaptureEvent(.cardAction, id: id, action: action)
  }
}

// MARK: Lifecycle

enum CapturePhase: String, Codable, Equatable {
  case idle
  /// A screenshot's or a recording's selector is up.
  case selecting
  /// The countdown, or the stream starting after it.
  case countdown
  case recording
  /// The movie is being finished.
  case finishing
}

/// What `record_cancel` has to undo, by the phase it found.
enum CaptureCancelStep: Equatable {
  /// Nothing under way.
  case nothing
  /// Close the selector; its worker returns `cancelled`.
  case selector
  /// The countdown or the stream's start: its worker sees the flag.
  case starting
  /// Finish the recording and delete the movie.
  case recording
  /// Wait for the movie being finished, then delete it.
  case finishing
}

/// What a `tick` asks the session to do.
enum CaptureTickEffect: Equatable {
  /// The capsule's question went away.
  case questionClosed
  /// `max_duration_s` is reached: finish the recording.
  case cap
}

/// One screenshot selector or recording at a time, and none while
/// Annotate records. Every call takes `now` in seconds on the host clock.
struct CaptureMachine {
  private(set) var phase = CapturePhase.idle
  private(set) var purpose: CapturePurpose?
  /// `record_cancel` came while the selector, countdown or start ran.
  private(set) var cancelRequested = false
  private(set) var startedAt: Double?
  private(set) var askingSince: Double?
  private(set) var maxDuration: Double = 1800
  private var events: [CaptureEvent] = []

  var asking: Bool { askingSince != nil }
  var isIdle: Bool { phase == .idle }

  /// Idle to selecting; false when a capture is under way or Annotate
  /// isn't idle.
  mutating func reserve(_ purpose: CapturePurpose, annotateIdle: Bool, maxDuration: Double = 1800)
    -> Bool
  {
    guard phase == .idle, annotateIdle else { return false }
    phase = .selecting
    self.purpose = purpose
    self.maxDuration = maxDuration.isFinite && maxDuration > 0 ? maxDuration : 1800
    cancelRequested = false
    startedAt = nil
    askingSince = nil
    events.removeAll()
    return true
  }

  /// A recording's selector chose (or none was shown): on to the
  /// countdown and the stream's start. False when cancelled meanwhile.
  mutating func selected() -> Bool {
    guard phase == .selecting, purpose == .recording, !cancelRequested else { return false }
    phase = .countdown
    return true
  }

  /// The stream runs: the recording's clock starts at `now`. False when
  /// cancelled meanwhile.
  mutating func started(now: Double) -> Bool {
    guard phase == .countdown, !cancelRequested else { return false }
    phase = .recording
    startedAt = now
    return true
  }

  mutating func requestCancel() -> CaptureCancelStep {
    switch phase {
    case .idle:
      return .nothing
    case .selecting:
      cancelRequested = true
      return .selector
    case .countdown:
      cancelRequested = true
      return .starting
    case .recording:
      return .recording
    case .finishing:
      return .finishing
    }
  }

  func elapsedMs(now: Double) -> Int {
    guard let startedAt, phase == .recording || phase == .finishing else { return 0 }
    return max(0, Int(((now - startedAt) * 1000).rounded(.down)))
  }

  mutating func capsule(_ action: AnnotateCapsuleAction, now: Double) {
    guard phase == .recording else { return }
    switch action {
    case .pen:
      break
    case .stop:
      askingSince = nil
      if events.last?.type != .recordStop { events.append(CaptureEvent(.recordStop)) }
    case .discard:
      askingSince = now
    case .confirmDiscard:
      guard askingSince != nil else { return }
      askingSince = nil
      if events.last?.type != .recordDiscard { events.append(CaptureEvent(.recordDiscard)) }
    case .keep:
      askingSince = nil
    }
  }

  mutating func tick(now: Double) -> [CaptureTickEffect] {
    guard phase == .recording, let startedAt else { return [] }
    var effects: [CaptureTickEffect] = []
    if let askingSince, now - askingSince >= AnnotateLimits.discardQuestion {
      self.askingSince = nil
      effects.append(.questionClosed)
    }
    if now - startedAt >= maxDuration { effects.append(.cap) }
    return effects
  }

  /// Recording to finishing. False unless recording.
  mutating func finishing() -> Bool {
    guard phase == .recording else { return false }
    phase = .finishing
    askingSince = nil
    return true
  }

  /// A recording that ended by itself is finished; its result waits for
  /// the host's `record_stop`.
  mutating func stoppedByItself(reason: String) {
    events.append(CaptureEvent(.recordStopped, reason: reason))
  }

  /// Back to idle from any phase.
  mutating func reset() {
    phase = .idle
    purpose = nil
    cancelRequested = false
    startedAt = nil
    askingSince = nil
  }

  mutating func drainEvents() -> [CaptureEvent] {
    defer { events.removeAll() }
    return events
  }
}
