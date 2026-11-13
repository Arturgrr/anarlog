import Foundation

/// What the dictation tells the HUD.
enum HudEvent: Decodable, Equatable {
  /// A recording starts; builds that send no position, or one this build
  /// does not know, mean the top.
  case started(position: HudPosition)
  case processing
  case completed
  case failed
  case cancelled
  case preview(stable: String, tentative: String)

  private enum CodingKeys: String, CodingKey {
    case type
    case position
    case stable
    case tentative
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(String.self, forKey: .type) {
    case "started":
      let position = try? container.decodeIfPresent(String.self, forKey: .position)
      self = .started(position: position.flatMap { HudPosition(rawValue: $0) } ?? .top)
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
  /// The notch indicator holds its check mark longer: it is the whole cue.
  private static let earsCompletedVisible: Double = 0.7
  private static let failedVisible: Double = 0.6
  /// The ears open and fold with the scope's bounce.
  private static let earsSpring = HudSpringSpec(
    duration: HudTuning.transition, bounce: HudTuning.bounce)

  let scope = HudScope()
  private var phase = Phase.hidden
  private var phaseStarted: Double = 0
  private var workingSince: Double = 0
  private var completionPending = false
  private var stage = HudStage.recording
  private var loudness = HudModel.silent
  private var stageSince: Double = 0
  private var earsOpen = HudSpring(at: 0)
  private var earsFade = HudSpring(at: 0)
  private var earsTarget: Float = 0
  /// Since an event, until a step finds everything settled out of sight.
  private(set) var active = false
  /// Whether the current look is still meant to be seen.
  private(set) var shown = false
  /// Whether the HUD is the notch indicator, set where it is placed: done
  /// then shows longer, and the ears must fold before the HUD is inactive.
  var ears = false
  private(set) var earsPose = HudEarsPose(
    open: 0, opacity: 0, stage: .recording, clock: 0, level: 0, reduceMotion: false)

  /// Whether the microphone is still being recorded, which is when the live
  /// text shows.
  var recording: Bool { phase == .recording }

  func handle(_ event: HudEvent, now: Double, reduceMotion: Bool) {
    let wasActive = active
    active = true
    switch event {
    case .started:
      // Outside notch mode the HUD hides without waiting for the ears to
      // fold, so a new dictation starts them closed.
      if !wasActive {
        earsOpen.jump(0)
        earsFade.jump(0)
      }
      phase = .recording
      phaseStarted = now
      completionPending = false
      loudness = Self.silent
      stage = .recording
      stageSince = now
      earsPose.stage = .recording
      earsPose.clock = 0
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
      case .completed: ears ? Self.earsCompletedVisible : Self.completedVisible
      case .cancelled: 0
      case .failed: Self.failedVisible
      case .hidden, .recording, .transcribing: nil
      }
    let finished = shownFor.map { elapsed >= $0 } ?? false
    let visible = phase != .hidden && !finished
    let previous = stage
    switch phase {
    case .recording: stage = .recording
    case .transcribing: stage = .processing
    case .completed: stage = .done
    case .failed: stage = .failed
    case .hidden, .cancelled: break
    }
    if stage != previous {
      stageSince = now
    }
    scope.advance(
      dt: Float(dt), stage: stage, visible: visible, loudness: loudness, reduceMotion: reduceMotion)
    stepEars(now: now, dt: Float(dt), visible: visible, reduceMotion: reduceMotion)
    shown = visible
    active = visible || !scope.settled || (ears && !earsSettled)
  }

  /// The ears open while shown and fold back into the notch after. With
  /// Reduce Motion they stay open and fade in and out instead.
  private func stepEars(now: Double, dt: Float, visible: Bool, reduceMotion: Bool) {
    let target: Float = visible ? 1 : 0
    earsTarget = target
    let opacity: Float
    if reduceMotion {
      earsOpen.jump(1)
      earsFade.step(to: target, spec: .reducedFade, dt: dt)
      opacity = earsFade.x
    } else {
      earsOpen.step(to: target, spec: Self.earsSpring, dt: dt)
      earsFade.jump(target)
      // Black on the black notch while narrow, so it never shows past it.
      opacity = earsOpen.x / 0.25
    }
    earsPose = HudEarsPose(
      open: max(earsOpen.x, 0),
      opacity: min(max(opacity, 0), 1),
      stage: stage,
      clock: Float(max(now - stageSince, 0)),
      level: scope.voiceLevel,
      reduceMotion: reduceMotion)
  }

  private var earsSettled: Bool {
    earsTarget == 0 && earsPose.opacity < 0.002
  }
}

/// The notch indicator's look for one frame.
struct HudEarsPose: Equatable {
  /// 0 for the notch itself, 1 for open; a spring, so a little past either.
  var open: Float
  var opacity: Float
  var stage: HudStage
  /// Seconds into `stage`.
  var clock: Float
  /// The voice, 0 to 1.
  var level: Float
  var reduceMotion: Bool
}
