import Foundation

/// What the dictation tells the HUD.
enum HudEvent: Decodable, Equatable {
  case started
  case processing
  case completed
  case failed
  case cancelled
  case preview(stable: String, tentative: String)

  private enum CodingKeys: String, CodingKey {
    case type
    case stable
    case tentative
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(String.self, forKey: .type) {
    case "started": self = .started
    case "processing": self = .processing
    case "completed": self = .completed
    case "failed": self = .failed
    case "cancelled": self = .cancelled
    case "preview":
      self = .preview(
        stable: try container.decode(String.self, forKey: .stable),
        tentative: try container.decode(String.self, forKey: .tentative))
    case let other:
      throw DecodingError.dataCorruptedError(
        forKey: .type, in: container, debugDescription: "unknown HUD event \(other)")
    }
  }
}

/// The HUD's lifecycle, ported from Hex's `src/dictation/indicator.rs`
/// (MIT, © 2026 Christopher Langton) for one dictation at a time: the phase
/// bookkeeping and how long each look shows, driving the scope. Time is
/// passed in, never read.
final class HudModel {
  private enum Phase {
    case hidden
    case recording
    case transcribing
    case completed
    case cancelled
    case failed
  }

  /// The loudness before any meter arrives, dBFS.
  private static let silent: Float = -120
  /// The shortest processing look: a fast transcription still shows the
  /// light passing along the traces before done clears them.
  private static let processingMinimum: Double = 0.2
  /// How long done shows before the HUD collapses: a third into done's
  /// 0.3 s wipe, so the collapse and the wipe end together.
  private static let completedVisible: Double = 0.1
  private static let failedVisible: Double = 0.6

  let scope = HudScope()
  private var phase = Phase.hidden
  private var phaseStarted: Double = 0
  private var workingSince: Double = 0
  private var completionPending = false
  private var stage = HudStage.recording
  private var loudness = HudModel.silent
  /// Since an event, until a step finds everything settled out of sight.
  private(set) var active = false

  /// Whether the microphone is still being recorded, which is when the live
  /// text shows.
  var recording: Bool { phase == .recording }

  func handle(_ event: HudEvent, now: Double, reduceMotion: Bool) {
    active = true
    switch event {
    case .started:
      phase = .recording
      phaseStarted = now
      completionPending = false
      loudness = Self.silent
      stage = .recording
      scope.restart(reduceMotion: reduceMotion)
    case .processing:
      if phase != .transcribing {
        workingSince = now
      }
      phase = .transcribing
      phaseStarted = now
      completionPending = false
    case .completed:
      if phase != .transcribing {
        phase = .transcribing
        workingSince = now
      }
      completionPending = true
    case .failed:
      phase = .failed
      phaseStarted = now
      completionPending = false
    case .cancelled:
      phase = .cancelled
      phaseStarted = now
      completionPending = false
    case .preview:
      break
    }
  }

  func meter(rms: Float) {
    loudness = HudLevel.loudness(rms: rms)
  }

  /// Advances `dt` seconds to `now`. Once everything has settled out of
  /// sight, `active` turns false.
  func step(now: Double, dt rawDt: Double, reduceMotion: Bool) {
    let dt = min(max(rawDt, 1.0 / 240), 1.0 / 20)
    if completionPending && now - workingSince >= Self.processingMinimum {
      phase = .completed
      phaseStarted = now
      completionPending = false
    }
    let elapsed = now - phaseStarted
    let shownFor: Double? =
      switch phase {
      case .completed: Self.completedVisible
      case .cancelled: 0
      case .failed: Self.failedVisible
      case .hidden, .recording, .transcribing: nil
      }
    let finished = shownFor.map { elapsed >= $0 } ?? false
    let visible = phase != .hidden && !finished
    switch phase {
    case .recording: stage = .recording
    case .transcribing: stage = .processing
    case .completed: stage = .done
    case .failed: stage = .failed
    case .hidden, .cancelled: break
    }
    scope.advance(
      dt: Float(dt), stage: stage, visible: visible, loudness: loudness, reduceMotion: reduceMotion)
    active = visible || !scope.settled
  }
}
