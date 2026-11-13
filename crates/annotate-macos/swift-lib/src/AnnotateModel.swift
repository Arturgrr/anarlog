// Annotate's lifecycle as plain state: the phases, the ink mode with its
// safety timeouts, the 20-minute cap and the capsule's discard question.
// The timings follow Hex (MIT, © 2026 Christopher Langton): `MAX_CAPTURE`
// in `src/capture_host.rs` and the capsule's "Discard?" in
// `docs/features/capture.md`. No clock is read here; every call takes `now`
// in seconds on the host clock, so tests drive it with their own.

import Foundation

enum AnnotateInkMode: String, Codable, Equatable {
  /// Click-through: the pointer belongs to the apps underneath.
  case off
  /// The pointer inks as it moves, no click needed (the held shortcut).
  case hover
  /// The pointer inks while its button is held (the pen).
  case drag
}

enum AnnotatePhase: String, Codable, Equatable {
  case idle
  /// Between `start` being called and the stream running.
  case starting
  case recording
  /// The movie is being finished.
  case finishing
}

enum AnnotateLimits {
  /// Hex's `MAX_CAPTURE`: a recording stops by itself after 20 minutes.
  static let maxDuration: Double = 20 * 60
  /// Ink left on with the pointer still this long goes back to off.
  static let inkIdle: Double = 30
  /// An unanswered "Discard?" goes back to recording, as Hex's capsule does.
  static let discardQuestion: Double = 4
}

/// What the host reads from `poll_events`.
struct AnnotateEvent: Codable, Equatable {
  enum Kind: String, Codable {
    /// The capsule's stop button.
    case stop
    /// The capsule's discard, confirmed.
    case discard
    /// The capsule's pen turned ink on (`drag`) or off.
    case penOn = "pen_on"
    case penOff = "pen_off"
    /// Ink went back to off without the host asking: `escape` or `idle`.
    case inkOff = "ink_off"
    /// The recording ended by itself (`max_duration` or `stream_error`);
    /// `stop` returns its result.
    case stopped
  }

  var type: Kind
  var reason: String?
  var message: String?

  init(_ type: Kind, reason: String? = nil, message: String? = nil) {
    self.type = type
    self.reason = reason
    self.message = message
  }
}

/// The capsule's buttons.
enum AnnotateCapsuleAction: Equatable {
  case pen
  case stop
  /// The ✕: asks "Discard?" first.
  case discard
  /// "Discard" in the question.
  case confirmDiscard
  /// "Keep" in the question.
  case keep
}

/// What a `tick` asks the session to do.
enum AnnotateTickEffect: Equatable {
  /// Ink went off by itself; the overlay lets the pointer through again.
  case inkOff
  /// The capsule's question went away.
  case questionClosed
  /// The cap is reached: finish the recording.
  case maxDuration
}

struct AnnotateMachine {
  private(set) var phase = AnnotatePhase.idle
  private(set) var ink = AnnotateInkMode.off
  private(set) var startedAt: Double?
  /// When the capsule started asking "Discard?".
  private(set) var askingSince: Double?
  private var lastActivity: Double = 0
  private var events: [AnnotateEvent] = []

  var asking: Bool { askingSince != nil }

  /// Idle to starting; false when something else is under way.
  mutating func reserve() -> Bool {
    guard phase == .idle else { return false }
    phase = .starting
    return true
  }

  /// The stream runs: the recording's clock starts at `now`.
  mutating func started(now: Double) {
    guard phase == .starting else { return }
    phase = .recording
    startedAt = now
    lastActivity = now
    ink = .off
    askingSince = nil
  }

  func elapsedMs(now: Double) -> Int {
    guard let startedAt, phase == .recording || phase == .finishing else { return 0 }
    return max(0, Int(((now - startedAt) * 1000).rounded(.down)))
  }

  /// The host's ink mode. Ignored unless recording; returns whether it
  /// changed.
  @discardableResult
  mutating func setInk(_ mode: AnnotateInkMode, now: Double) -> Bool {
    guard phase == .recording, mode != ink else { return false }
    ink = mode
    lastActivity = now
    return true
  }

  mutating func pointerMoved(now: Double) {
    lastActivity = now
  }

  /// Escape: ink off, never the recording. Returns whether ink was on.
  @discardableResult
  mutating func escape() -> Bool {
    guard phase == .recording, ink != .off else { return false }
    ink = .off
    events.append(AnnotateEvent(.inkOff, reason: "escape"))
    return true
  }

  mutating func capsule(_ action: AnnotateCapsuleAction, now: Double) {
    guard phase == .recording else { return }
    switch action {
    case .pen:
      lastActivity = now
      if ink == .drag {
        ink = .off
        events.append(AnnotateEvent(.penOff))
      } else {
        ink = .drag
        events.append(AnnotateEvent(.penOn))
      }
    case .stop:
      askingSince = nil
      if events.last?.type != .stop {
        events.append(AnnotateEvent(.stop))
      }
    case .discard:
      askingSince = now
    case .confirmDiscard:
      guard askingSince != nil else { return }
      askingSince = nil
      events.append(AnnotateEvent(.discard))
    case .keep:
      askingSince = nil
    }
  }

  mutating func tick(now: Double) -> [AnnotateTickEffect] {
    guard phase == .recording, let startedAt else { return [] }
    var effects: [AnnotateTickEffect] = []
    if ink != .off, now - lastActivity >= AnnotateLimits.inkIdle {
      ink = .off
      events.append(AnnotateEvent(.inkOff, reason: "idle"))
      effects.append(.inkOff)
    }
    if let askingSince, now - askingSince >= AnnotateLimits.discardQuestion {
      self.askingSince = nil
      effects.append(.questionClosed)
    }
    if now - startedAt >= AnnotateLimits.maxDuration {
      effects.append(.maxDuration)
    }
    return effects
  }

  /// Recording to finishing: ink goes off and the capsule's question
  /// closes. False unless recording.
  mutating func finishing() -> Bool {
    guard phase == .recording else { return false }
    phase = .finishing
    ink = .off
    askingSince = nil
    return true
  }

  /// A recording that ended by itself is finished; its result waits for
  /// the host's `stop`.
  mutating func stoppedByItself(reason: String, message: String? = nil) {
    events.append(AnnotateEvent(.stopped, reason: reason, message: message))
  }

  /// Back to idle from any phase: stopped, cancelled or failed to start.
  mutating func reset() {
    phase = .idle
    ink = .off
    startedAt = nil
    askingSince = nil
  }

  mutating func drainEvents() -> [AnnotateEvent] {
    defer { events.removeAll() }
    return events
  }

  /// The capsule's clock: `m:ss`, hours past an hour.
  static func clock(ms: Int) -> String {
    let seconds = max(0, ms) / 1000
    let (hours, minutes, rest) = (seconds / 3600, seconds / 60 % 60, seconds % 60)
    let tail = String(format: "%02ld", rest)
    if hours > 0 {
      return "\(hours):" + String(format: "%02ld", minutes) + ":" + tail
    }
    return "\(minutes):" + tail
  }
}

/// What `status` returns.
struct AnnotateStatus: Codable, Equatable {
  var phase: AnnotatePhase
  var elapsedMs: Int
  var ink: AnnotateInkMode
  /// A recording that ended by itself has a result for `stop`.
  var resultPending: Bool

  enum CodingKeys: String, CodingKey {
    case phase
    case elapsedMs = "elapsed_ms"
    case ink
    case resultPending = "result_pending"
  }

  static let idle = AnnotateStatus(phase: .idle, elapsedMs: 0, ink: .off, resultPending: false)
}
