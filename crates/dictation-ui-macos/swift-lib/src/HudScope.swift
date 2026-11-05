import Foundation
import simd

// Dot scope, the dictation HUD's field of dots lit by a braided pair of
// oscilloscope traces that follow the voice. Ported from Hex (MIT,
// © 2026 Christopher Langton): `src/rune_hud/spring.rs`,
// `src/rune_hud/dot_scope.rs` and `src/rune_hud/dot_scope/scope.rs`, with
// Hex's default tuning and its default processing look (Flow).

private let tau: Float = 2 * .pi

// MARK: - Springs (`spring.rs`)

/// Duration + bounce, SwiftUI's mapping (ω = 2π / duration, ζ = 1 − bounce).
struct HudSpringSpec {
  var duration: Float
  var bounce: Float

  /// The short crossfade kept with Reduce Motion.
  static let reducedFade = HudSpringSpec(duration: 0.16, bounce: 0)

  var omega: Float { tau / max(duration, 0.01) }
  var zeta: Float { bounce >= 0 ? max(1 - bounce, 0) : 1 / max(1 + bounce, 0.01) }
}

/// An exact, frame-rate independent damped harmonic oscillator.
struct HudSpring {
  private static let criticalTolerance: Float = 1e-4

  var x: Float
  var v: Float = 0
  var target: Float

  init(at value: Float) {
    x = value
    target = value
  }

  mutating func jump(_ value: Float) {
    x = value
    v = 0
    target = value
  }

  mutating func step(to newTarget: Float, spec: HudSpringSpec, dt: Float) {
    target = newTarget
    guard dt > 0, dt.isFinite else { return }
    let omega = spec.omega
    let zeta = spec.zeta
    let x0 = x - target
    let v0 = v
    if zeta < 1 - Self.criticalTolerance {
      let decay = zeta * omega
      let omegaD = omega * (1 - zeta * zeta).squareRoot()
      let e = exp(-decay * dt)
      let s = sin(omegaD * dt)
      let c = cos(omegaD * dt)
      let sinOverD = s / omegaD
      x = target + e * (x0 * (c + decay * sinOverD) + v0 * sinOverD)
      v = e * (-x0 * omega * omega * sinOverD + v0 * (c - decay * sinOverD))
    } else if zeta > 1 + Self.criticalTolerance {
      let root = (zeta * zeta - 1).squareRoot()
      let slow = -omega / (zeta + root)
      let fast = -omega * (zeta + root)
      let denom = slow - fast
      let slowExp = exp(slow * dt)
      let fastExp = exp(fast * dt)
      x =
        target + (-fast * slowExp + slow * fastExp) / denom * x0 + (slowExp - fastExp) / denom * v0
      v =
        slow * fast * (fastExp - slowExp) / denom * x0 + (slow * slowExp - fast * fastExp) / denom
        * v0
    } else {
      let e = exp(-omega * dt)
      let c = v0 + omega * x0
      x = target + (x0 + c * dt) * e
      v = (v0 - omega * c * dt) * e
    }
  }
}

// MARK: - Level (`dot_scope.rs`)

enum HudLevel {
  /// A meter's RMS as dBFS.
  static func loudness(rms: Float) -> Float {
    20 * log10(max(rms, 0) + 1e-6)
  }
}

/// A slow auto level: the loudest the speaker has recently been reads as full
/// and the room as silent, so a quiet microphone and a loud one move the
/// scope alike. The peak never sits less than 16 dB above the room or the
/// noise floor, so silence is never boosted to full.
struct HudAutoLevel {
  var peak: Float = -30
  var room: Float = -55

  mutating func step(loudness: Float, h: Float, release: Float, noiseFloor: Float) -> Float {
    let db = max(loudness, -120)
    func follow(_ value: inout Float, _ target: Float, _ time: Float) {
      value += (target - value) * (1 - exp(-h / max(time, 1e-3)))
    }
    follow(&room, db, db < room ? 0.3 : 6.0)
    let lowest = max(room, noiseFloor) + 16
    if db > peak {
      follow(&peak, db, 0.04)
    } else {
      follow(&peak, lowest, release)
    }
    peak = max(peak, lowest)
    let low = max(max(room, noiseFloor) + 5, peak - 24)
    return min(1, max(0, (db - low) / max(peak - low, 1)))
  }
}

// MARK: - Simulation (`scope.rs`)

enum HudStage {
  case recording
  case processing
  case done
  case failed
}

/// The plate's pose and the field's global terms, for the shader.
struct HudPose {
  var width: Float
  var height: Float
  var opacity: Float
  var scale: Float
  var softness: Float
  var cool: Float
  var fail: Float
  var glow: Float
  var grid: Float
  var live: Float
}

/// Hex's default `Tuning`.
enum HudTuning {
  static let columns = 43
  static let rows = 9
  static let spacing: Float = 2.6
  static let width: Float = 112
  static let processingWidth: Float = 76
  static let height: Float = 26
  static let braidSpeed: Float = 1
  static let helixCycles: Float = 1.6
  static let gain: Float = 1
  static let response: Float = 6.5
  static let release: Float = 0.15
  static let historySpeed: Float = 150
  static let phosphor: Float = 0.6
  static let glow: Float = 1
  static let saturation: Float = 1
  static let shimmerPass: Float = 0.55
  static let shimmer: Float = 1
  static let transition: Float = 0.3
  static let bounce: Float = 0.15
  static let autoRelease: Float = 3
  static let noiseFloor: Float = -60
}

private struct Voice {
  var level: Float = 0
  var reservoir: Float = 0
  var energy: Float = 0
  var kick: Float = 0
  var kickVelocity: Float = 0
  var band: Float = 0

  mutating func step(raw: Float, h: Float) {
    let previous = level
    level += (raw - level) * (1 - exp(-h / (raw > level ? 0.035 : 0.095)))
    let rise = max((level - previous) / h, 0)
    reservoir += (1.75 * level * level - reservoir / 1.8) * h
    energy = 1 - exp(-reservoir * 1.45)
    let w = tau * 1.3
    let z: Float = 0.22
    kickVelocity += (-w * w * kick - 2 * z * w * kickVelocity + 15 * rise + 2.2 * level) * h
    kick += kickVelocity * h
    band += (raw - band) * (1 - exp(-h / (raw > band ? 0.025 : 0.14)))
  }
}

private struct Trace {
  static let history = 512

  var envelope: Float = 0
  var amplitude: Float = 0
  var amplitudeVelocity: Float = 0
  var glowFast: Float = 0
  var glowSpring: Float = 0
  var glowSpringVelocity: Float = 0
  var glowSlow: Float = 0
  var glow: Float = 0
  var phases: [Float]
  var history = [Float](repeating: 0, count: Trace.history * 5)
  var head = 0

  init(phases: [Float]) {
    self.phases = phases
  }

  mutating func tick(voice: Voice, live: Float, speed: Float, h: Float) {
    func follow(_ value: inout Float, _ target: Float, _ rise: Float, _ fall: Float) {
      value += (target - value) * (1 - exp(-h / (target > value ? rise : fall)))
    }
    follow(&envelope, voice.level, 0.022, HudTuning.release)
    let w = tau * HudTuning.response
    let z: Float = 0.52
    amplitudeVelocity += (-w * w * (amplitude - envelope) - 2 * z * w * amplitudeVelocity) * h
    amplitude += amplitudeVelocity * h
    follow(&glowFast, voice.level, 0.045, 0.13)
    let gw = tau * 3.6
    let gz: Float = 0.5
    glowSpringVelocity +=
      (-gw * gw * (glowSpring - glowFast) - 2 * gz * gw * glowSpringVelocity) * h
    glowSpring += glowSpringVelocity * h
    follow(&glowSlow, voice.level, 0.15, 0.7)
    let swell = 0.8 * max(glowSpring - 0.25, 0) + 0.04 * max(voice.kick, -0.5)
    glow = min(max(swell, 0) + 0.42 * glowSlow + 0.2 * voice.energy, 1.15) * live
    let go = 0.6 + 1.1 * min(envelope * 1.6, 1)
    for lane in 0..<4 {
      phases[lane] = fmodf(phases[lane] + h * tau * HudScope.speeds[lane] * go * speed, tau)
    }
    // With flat bands each group is the mean, so the prototype's
    // `g / (mean + 0.06)` emphasis is the same for every component.
    let emphasis = 0.35 + 0.65 * min(voice.band / (voice.band + 0.06), 2)
    let offset = head * 5
    let amp = max(amplitude, 0) * live
    history[offset] = amp
    for c in 0..<4 {
      history[offset + 1 + c] = amp * HudScope.base[c] * emphasis
    }
    head = (head + 1) % Trace.history
  }

  func past(delay: Float, channel: Int) -> Float {
    let count = Trace.history
    let d = min(delay / HudScope.step, Float(count - 2))
    let i = Int(d.rounded(.down))
    let k = d - Float(i)
    let a = (head + 2 * count - 1 - i) % count
    let b = (a + count - 1) % count
    return history[a * 5 + channel] * (1 - k) + history[b * 5 + channel] * k
  }
}

private func smoothstep(_ a: Float, _ b: Float, _ x: Float) -> Float {
  let t = min(max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}

private func bump(_ d: Float, _ w: Float) -> Float {
  exp(-(d / w) * (d / w))
}

private func remEuclid(_ a: Float, _ b: Float) -> Float {
  let r = fmodf(a, b)
  return r < 0 ? r + abs(b) : r
}

/// The Dot scope simulation, stepped at a fixed 240 Hz so any frame rate
/// draws the same picture. Yields one (brightness, freshness) pair per dot.
final class HudScope {
  static let step: Float = 1 / 240
  fileprivate static let speeds: [Float] = [0.8, 1.25, 1.85, 2.6]
  fileprivate static let base: [Float] = [0.55, 0.42, 0.3, 0.2]
  private static let spatial: [Float] = [1.4, 2.4, 3.8, 5.6]
  private static let samplesPerColumn = 3
  private static let startWidth: Float = 30
  private static let enter: Float = 0.42
  private static let wipe: Float = 0.3
  private static let phosphorHead: Float = 0.15
  private static let breathPeriod: Float = 5.5
  private static let hiddenScale: Float = 0.9
  private static let hiddenSoftness: Float = 3
  /// How much the resting helix swells while Flow works.
  private static let workHelix: Float = 2.6
  /// Flow's bands sit this far apart, as a share of the processing width.
  private static let flowSpacingShare: Float = 0.7
  /// The recording carrier's slowest turn, Hz.
  private static let carrierRest: Float = 0.14

  let columns = HudTuning.columns
  let rows = HudTuning.rows
  private(set) var stage: HudStage = .recording
  /// Each dot's (brightness, freshness), row by row, as normalized u16s.
  private(set) var dots: [SIMD2<UInt16>]
  private(set) var grid: Float = 0

  private var elapsed: Float = 0
  private var speedAtDone: Float = 0
  private var flowOffset: Float = 0
  private var flowTurn: Float = 0
  private var auto = HudAutoLevel()
  private var voices = [Voice(), Voice()]
  private var traces = HudScope.freshTraces()
  private var live: Float = 0
  private var carrier: Float = 0
  private var time: Float = 0
  private var steps: UInt64 = 0
  private var pending: Float = 0
  private var reduceMotion = false
  private var heads: [[Float]]
  private var tails: [[Float]]
  private var ys: [[Float]]
  private var brightness: [[Float]]
  private var width = HudSpring(at: HudScope.startWidth)
  private var opacity = HudSpring(at: 0)
  private var scale = HudSpring(at: HudScope.hiddenScale)
  private var softness = HudSpring(at: HudScope.hiddenSoftness)
  private var cool = HudSpring(at: 0)
  private var fail = HudSpring(at: 0)

  private static func freshTraces() -> [Trace] {
    [Trace(phases: [0.1, 1.7, 3.3, 4.6]), Trace(phases: [2.4, 0.6, 5.1, 1.9])]
  }

  init() {
    let count = columns * rows
    let samples = (columns - 1) * Self.samplesPerColumn + 1
    dots = Array(repeating: .zero, count: count)
    heads = Array(repeating: Array(repeating: 0, count: count), count: 2)
    tails = heads
    ys = Array(repeating: Array(repeating: 0, count: samples), count: 2)
    brightness = ys
  }

  /// Starts a recording from nothing: the scanner unfolds the trace again.
  /// The auto level remembers the speaker.
  func restart(reduceMotion reduce: Bool) {
    let count = columns * rows
    let samples = (columns - 1) * Self.samplesPerColumn + 1
    stage = .recording
    elapsed = 0
    speedAtDone = 0
    flowOffset = 0
    flowTurn = 0
    voices = [Voice(), Voice()]
    traces = Self.freshTraces()
    live = 0
    carrier = 0
    time = 0
    steps = 0
    pending = 0
    reduceMotion = false
    dots = Array(repeating: .zero, count: count)
    heads = Array(repeating: Array(repeating: 0, count: count), count: 2)
    tails = heads
    ys = Array(repeating: Array(repeating: 0, count: samples), count: 2)
    brightness = ys
    grid = 0
    width = HudSpring(at: Self.startWidth)
    opacity = HudSpring(at: 0)
    scale = HudSpring(at: Self.hiddenScale)
    softness = HudSpring(at: Self.hiddenSoftness)
    cool = HudSpring(at: 0)
    fail = HudSpring(at: 0)
    if reduce {
      scale.jump(1)
      softness.jump(0)
      width.jump(HudTuning.width)
    }
  }

  var pose: HudPose {
    HudPose(
      width: max(width.x, HudTuning.height),
      height: HudTuning.height,
      opacity: min(max(opacity.x, 0), 1),
      scale: max(scale.x, 0.01),
      softness: min(max(softness.x, 0), Self.hiddenSoftness),
      cool: min(max(cool.x, 0), 1),
      fail: min(max(fail.x, 0), 1),
      glow: (traces[0].glow + traces[1].glow) / 2 * HudTuning.glow,
      grid: grid,
      live: live)
  }

  /// Whether the scope has faded out after being hidden.
  var settled: Bool {
    opacity.target == 0 && opacity.x < 0.002
  }

  /// Advances by `dt` seconds in fixed 240 Hz steps.
  func advance(
    dt: Float, stage next: HudStage, visible: Bool, loudness: Float, reduceMotion reduce: Bool
  ) {
    if next != stage {
      if next == .done {
        speedAtDone = 1.5 * pulseSpeed
      }
      if next == .processing {
        flowOffset = -width.x / 2 - 4
      }
      stage = next
      elapsed = 0
    }
    reduceMotion = reduce
    pending += min(max(dt, 0), 0.25)
    while pending >= Self.step {
      pending -= Self.step
      stepOnce(visible: visible, loudness: loudness, reduce: reduce)
    }
  }

  /// One band per this many seconds.
  private var workPeriod: Float { 2 * max(HudTuning.shimmerPass, 0.05) }
  private var flowSpacing: Float { Self.flowSpacingShare * HudTuning.processingWidth }
  private var flowSpeed: Float { flowSpacing / workPeriod }
  /// The carrier turn that moves the helix at Flow's band speed, Hz.
  private var flowTurnHz: Float { flowSpeed * HudTuning.helixCycles / max(width.x, 1) }
  private var pulseSpeed: Float { (HudTuning.processingWidth / 2 + 12) / (1.4 * workPeriod) }

  private func stepOnce(visible: Bool, loudness: Float, reduce: Bool) {
    let h = Self.step
    let recording = stage == .recording && visible
    var level: Float = 0
    if recording {
      let auto = self.auto.step(
        loudness: loudness, h: h, release: HudTuning.autoRelease, noiseFloor: HudTuning.noiseFloor)
      level = min(max(auto * HudTuning.gain, 0), 1)
    }
    voices[0].step(raw: level, h: h)
    voices[1].step(raw: level * 0.85, h: h)
    live += ((recording ? 1 : 0) - live) * (1 - exp(-h / 0.55))
    let speed: Float = reduce ? 0 : HudTuning.braidSpeed
    traces[0].tick(voice: voices[0], live: live, speed: speed, h: h)
    traces[1].tick(voice: voices[1], live: live, speed: speed, h: h)
    let energy = max(voices[0].energy, voices[1].energy)
    let working = stage == .processing || stage == .done
    flowTurn += ((working ? 1 : 0) - flowTurn) * (1 - exp(-h / 0.25))
    if working {
      flowOffset += flowSpeed * h
    }
    let rest = Self.carrierRest + 0.22 * energy
    let turn = rest + (flowTurnHz - rest) * flowTurn
    carrier = fmodf(carrier + h * tau * turn * speed, tau)

    let targetWidth: Float
    switch stage {
    case .recording: targetWidth = HudTuning.width
    case .processing, .done: targetWidth = HudTuning.processingWidth
    case .failed: targetWidth = width.target
    }
    let coolTarget: Float = working ? 1 : 0
    let failTarget: Float = stage == .failed ? 1 : 0
    let shown: Float = visible ? 1 : 0
    let fade = HudSpringSpec(duration: HudTuning.transition, bounce: 0)
    let bouncy = HudSpringSpec(duration: HudTuning.transition, bounce: HudTuning.bounce)
    if reduce {
      width.jump(targetWidth)
      scale.jump(1)
      softness.jump(0)
      opacity.step(to: shown, spec: .reducedFade, dt: h)
      cool.step(to: coolTarget, spec: .reducedFade, dt: h)
      fail.step(to: failTarget, spec: .reducedFade, dt: h)
    } else {
      width.step(to: targetWidth, spec: bouncy, dt: h)
      opacity.step(to: shown, spec: fade, dt: h)
      scale.step(to: visible ? 1 : Self.hiddenScale, spec: bouncy, dt: h)
      softness.step(to: visible ? 0 : Self.hiddenSoftness, spec: fade, dt: h)
      cool.step(to: coolTarget, spec: fade, dt: h)
      fail.step(to: failTarget, spec: fade, dt: h)
    }

    elapsed += h
    time += h
    steps &+= 1
    if steps % 2 == 0 {
      beam(hb: 2 * h)
    }
  }

  private func hermite(start: Float, speed: Float, end: Float, t rawT: Float) -> Float {
    let t = min(max(rawT, 0), 1)
    let t2 = t * t
    let t3 = t2 * t
    return (2 * t3 - 3 * t2 + 1) * start + (t3 - 2 * t2 + t) * Self.wipe * speed
      + (3 * t2 - 2 * t3) * end
  }

  /// Flow's bands, as light along the plate.
  private func flowLight(_ x: Float) -> Float {
    let spacing = flowSpacing
    return bump(remEuclid(x - flowOffset + spacing / 2, spacing) - spacing / 2, 7)
  }

  private enum Envelope {
    case enter(reach: Float, head: Float, unfold: Float)
    case work(head: Float, swell: Float)
    case clear(front: Float, head: Float, glow: Float, swell: Float)
  }

  private struct Scan {
    var helix: Float
    var decay: Float
    var tail: Float
    var grid: Float
    var envelope: Envelope
  }

  private func scan(width: Float) -> Scan {
    let e = elapsed
    let still = Scan(
      helix: 1, decay: 1, tail: 1, grid: 1, envelope: .enter(reach: 1e4, head: 0, unfold: 1))
    if stage == .failed || reduceMotion {
      return still
    }
    switch stage {
    case .recording:
      let pass = 0.5 - 0.5 * cos(.pi * min(max(e / Self.enter, 0), 1))
      return Scan(
        helix: 1, decay: 1, tail: 1, grid: min(e / 0.3, 1),
        envelope: .enter(
          reach: (width / 2 + 12) * pass,
          head: 2.8 * (1 - smoothstep(0.08, Self.enter, e)),
          unfold: smoothstep(0, 0.1, e)))
    case .processing:
      let enter = smoothstep(0, 0.35, e)
      return Scan(
        helix: 1 + (Self.workHelix - 1) * enter, decay: 1, tail: 1, grid: 1,
        envelope: .work(
          head: 2.5 * smoothstep(0.05, 0.3, e) * HudTuning.shimmer, swell: 0.9 * enter))
    case .done:
      // A front clears the field from the middle out as it collapses, while
      // the light ahead of it fades.
      return Scan(
        helix: Self.workHelix,
        decay: 1 - 0.6 * smoothstep(0, 0.12, e),
        tail: 1 - smoothstep(0, 0.15, e),
        grid: 1 - smoothstep(0.2, 0.4, e),
        envelope: .clear(
          front: hermite(start: 0, speed: speedAtDone, end: width / 2 + 8, t: e / Self.wipe),
          head: 2.8 * smoothstep(0, 0.04, e) * (1 - smoothstep(0.22, 0.32, e)),
          glow: 2.5 * HudTuning.shimmer * (1 - smoothstep(0, 0.18, e)),
          swell: 0.9))
    case .failed:
      return still
    }
  }

  /// (amplitude, brightness, swell) at `x`.
  private func scanAt(_ scan: Scan, _ x: Float) -> (Float, Float, Float) {
    switch scan.envelope {
    case .enter(let reach, let head, let unfold):
      let d = abs(x)
      let drawn = unfold * (1 - smoothstep(max(reach - 14, 0), max(reach, 0.001), d))
      let amplitude = drawn * (1 - smoothstep(max(reach - 22, 0), max(reach - 3, 0.001), d))
      let beam = head * bump(d - reach, 6)
      let swell = 1.8 * unfold * (head / 2.8) * bump(d - max(reach - 14, 0), 14)
      return (amplitude, amplitude + beam, swell)
    case .work(let head, let swell):
      let light = flowLight(x)
      return (1, 1 + head * light, swell * light)
    case .clear(let front, let head, let glow, let swell):
      let d = abs(x)
      let keep = smoothstep(front - 12, front - 2, d)
      let light = flowLight(x)
      return (keep, keep * (1 + glow * light) + head * bump(d - front, 6), keep * swell * light)
    }
  }

  /// Draws both traces into the dot field and decays the phosphor.
  private func beam(hb: Float) {
    let sub = Self.samplesPerColumn
    let samples = (columns - 1) * sub + 1
    let pitch = HudTuning.spacing
    let width = max(self.width.x, HudTuning.height)
    let scan = scan(width: width)
    grid = scan.grid
    let mid = Float(rows - 1) / 2
    let half = mid - 0.55
    let breath: Float = reduceMotion ? 0.5 : 0.5 + 0.5 * sin(time * tau / Self.breathPeriod)
    let rest = (0.55 + 0.35 * breath) * (0.4 + 0.6 * live) * scan.helix
    let halfWidth = width / 2
    for k in 0..<2 {
      let trace = traces[k]
      let sign: Float = k == 0 ? 1 : -1
      for s in 0..<samples {
        let x = (Float(s) / Float(sub) - Float(columns - 1) / 2) * pitch
        if abs(x) > halfWidth {
          ys[k][s] = mid
          brightness[k][s] = 0
          continue
        }
        let (amplitude, bright, swell) = scanAt(scan, x)
        let own = abs(x)
        let xn = (x + halfWidth) / width
        let ends = min(
          smoothstep(-halfWidth + 3, -halfWidth + 17, x),
          smoothstep(-halfWidth + 3, -halfWidth + 17, -x))
        let reach = 1 - 0.8 * smoothstep(14, halfWidth, own)
        let delay = own / HudTuning.historySpeed
        let a = trace.past(delay: delay, channel: 0)
        var spread: Float = 0
        for c in 0..<4 {
          spread +=
            trace.past(delay: delay, channel: 1 + c)
            * sin(tau * Self.spatial[c] * xn - trace.phases[c])
        }
        let helix =
          (rest + swell + half * 0.55 * a * reach) * sin(tau * HudTuning.helixCycles * xn - carrier)
        let y = half * tanh((helix + half * 0.7 * spread * reach) / half) * ends * amplitude
        ys[k][s] = mid - sign * y
        let spatial = (0.3 + 0.7 * min(a * 1.8, 1)) * (0.45 + 0.55 * ends)
        brightness[k][s] = spatial * amplitude + 0.36 * max(bright - amplitude, 0)
      }
      for s in 0..<samples {
        let slope = (ys[k][min(s + 1, samples - 1)] - ys[k][max(s - 1, 0)]) * Float(sub) / 2
        brightness[k][s] *= 1 - 0.55 + 0.55 / (1 + 0.22 * slope * slope).squareRoot()
      }
    }

    let headKeep = exp(-hb / (Self.phosphorHead * scan.decay))
    let tailKeep = exp(-hb / (HudTuning.phosphor * scan.decay))
    let dx = 1 / Float(sub)
    for i in 0..<columns {
      let s0 = max(i - 3, 0) * sub
      let s1 = min((i + 3) * sub, samples - 1)
      for j in 0..<rows {
        let n = j * columns + i
        var now: Float = 0
        var total: Float = 0
        var lit: (Float, Float) = (0, 0)
        for k in 0..<2 {
          var best = Float.greatestFiniteMagnitude
          var nearest = i * sub
          for s in s0..<s1 {
            let ay = ys[k][s]
            let dy = ys[k][s + 1] - ay
            let px = Float(i) - Float(s) * dx
            let py = Float(j) - ay
            let t = min(max((px * dx + py * dy) / (dx * dx + dy * dy), 0), 1)
            let ex = px - t * dx
            let ey = py - t * dy
            let d2 = ex * ex + ey * ey
            if d2 < best {
              best = d2
              nearest = s
            }
          }
          let shine = brightness[k][nearest]
          let onBeam = exp(-best / 0.25)
          let instant = min(onBeam + 0.5 * exp(-best.squareRoot() / 0.8), 1.2) * shine
          let core = onBeam * shine
          heads[k][n] = max(heads[k][n] * headKeep, core)
          tails[k][n] = max(tails[k][n] * tailKeep, core)
          let light = max(instant, max(heads[k][n], 0.55 * scan.tail * tails[k][n]))
          if k == 0 { lit.0 = light } else { lit.1 = light }
          now += instant
          total += light
        }
        let power = min(max(1 - (1 - min(lit.0, 1)) * (1 - min(lit.1, 1)), 0), 1)
        let fresh = min(now / max(total, 1e-4), 1)
        dots[n] = SIMD2(
          UInt16((power * 65535).rounded()), UInt16((max(fresh, 0) * 65535).rounded()))
      }
    }
  }
}

// MARK: - Palette (`scope.rs`)

/// Dot scope's colours for one frame, sRGB: warm pearl while recording,
/// cooling to agent blue while processing, and coral on failure.
struct HudPalette {
  var base: SIMD3<Float>
  var core: SIMD3<Float>
  var plate: SIMD4<Float>
  var rim: SIMD4<Float>
  var shadow: SIMD4<Float>

  init(dark: Bool, pose: HudPose, saturation: Float = HudTuning.saturation) {
    let you: SIMD3<Float> = dark ? [0.86, 0.83, 0.77] : [0.62, 0.53, 0.40]
    let youCore: SIMD3<Float> = dark ? [0.98, 0.96, 0.92] : [0.47, 0.38, 0.26]
    let agent: SIMD3<Float> = dark ? [0.70, 0.78, 0.90] : [0.40, 0.47, 0.58]
    let agentCore: SIMD3<Float> = dark ? [0.92, 0.95, 1.0] : [0.24, 0.31, 0.43]
    let coral: SIMD3<Float> = dark ? [1.0, 0.38, 0.31] : [0.9, 0.27, 0.21]
    let coralCore: SIMD3<Float> = dark ? [1.0, 0.66, 0.6] : [0.7, 0.18, 0.13]
    func mix(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ t: Float) -> SIMD3<Float> { a + (b - a) * t }
    func saturate(_ c: SIMD3<Float>) -> SIMD3<Float> {
      let luma = 0.2126 * c.x + 0.7152 * c.y + 0.0722 * c.z
      let out = SIMD3(repeating: luma) + (c - SIMD3(repeating: luma)) * saturation
      return simd_clamp(out, SIMD3(repeating: 0), SIMD3(repeating: 1))
    }
    base = saturate(mix(mix(you, agent, pose.cool), coral, pose.fail))
    core = saturate(mix(mix(youCore, agentCore, pose.cool), coralCore, pose.fail))
    plate = dark ? [17 / 255, 17 / 255, 20 / 255, 0.94] : [252 / 255, 251 / 255, 249 / 255, 0.96]
    rim = dark ? [1, 1, 1, 0.11] : [0, 0, 0, 0.09]
    shadow = dark ? [0, 0, 0, 0.5] : [20 / 255, 24 / 255, 40 / 255, 0.2]
  }
}
