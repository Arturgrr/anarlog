// Ink as plain data: strokes recorded in the display's points, and what
// shows of them on screen at a moment. The look follows Hex (MIT,
// © 2026 Christopher Langton), `src/rune_ui/capture_capsule/ink.rs`: red
// `#ff3b30`, 4.5 pt strokes, lifted ink held 650 ms then faded over 650 ms
// on a squared curve, and the edge glow rising over 0.12 s and gone by
// 1.1 s.

import CoreGraphics
import Foundation

/// One point of a stroke: display points from the display's top-left
/// corner, and ms from the recording's start.
struct AnnotatePoint: Codable, Equatable {
  var x: Double
  var y: Double
  var tMs: Int

  enum CodingKeys: String, CodingKey {
    case x
    case y
    case tMs = "t_ms"
  }
}

struct AnnotateStroke: Codable, Equatable {
  var mode: AnnotateInkMode
  var points: [AnnotatePoint]

  var t0Ms: Int { points.first?.tMs ?? 0 }
  var t1Ms: Int { points.last?.tMs ?? 0 }

  enum CodingKeys: String, CodingKey {
    case mode
    case t0Ms = "t0_ms"
    case t1Ms = "t1_ms"
    case points
  }

  init(mode: AnnotateInkMode, points: [AnnotatePoint]) {
    self.mode = mode
    self.points = points
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    mode = try container.decode(AnnotateInkMode.self, forKey: .mode)
    points = try container.decode([AnnotatePoint].self, forKey: .points)
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(mode, forKey: .mode)
    try container.encode(t0Ms, forKey: .t0Ms)
    try container.encode(t1Ms, forKey: .t1Ms)
    try container.encode(points, forKey: .points)
  }
}

/// Records strokes in one display's points, normalised as they arrive:
/// clamped to the display, times never going back, points closer than
/// `minStep` to the last one dropped, and a hover stroke that never moved
/// dropped (a drag that never moved is a dot, and kept).
struct AnnotateStrokeRecorder {
  static let minStep: Double = 0.5

  let size: CGSize
  private(set) var finished: [AnnotateStroke] = []
  private(set) var live: AnnotateStroke?

  init(size: CGSize) {
    self.size = size
  }

  /// Every stroke, the live one last.
  var strokes: [AnnotateStroke] { live.map { finished + [$0] } ?? finished }

  mutating func begin(_ mode: AnnotateInkMode, at point: CGPoint, tMs: Int) {
    end(tMs: tMs)
    guard mode != .off else { return }
    live = AnnotateStroke(mode: mode, points: [clamp(point, tMs: tMs, after: nil)])
  }

  mutating func add(_ point: CGPoint, tMs: Int) {
    guard var stroke = live, let last = stroke.points.last else { return }
    let next = clamp(point, tMs: tMs, after: last)
    guard hypot(next.x - last.x, next.y - last.y) >= Self.minStep else { return }
    stroke.points.append(next)
    live = stroke
  }

  mutating func end(tMs: Int) {
    guard let stroke = live else { return }
    live = nil
    if stroke.mode == .hover && stroke.points.count < 2 { return }
    finished.append(stroke)
  }

  private func clamp(_ point: CGPoint, tMs: Int, after last: AnnotatePoint?) -> AnnotatePoint {
    let x = min(max(Double(point.x), 0), Double(size.width))
    let y = min(max(Double(point.y), 0), Double(size.height))
    let earliest = last?.tMs ?? 0
    return AnnotatePoint(x: x, y: y, tMs: max(tMs, earliest, 0))
  }
}

enum AnnotateInkLook {
  /// `#ff3b30`.
  static let red = (r: 1.0, g: 59.0 / 255, b: 48.0 / 255)
  static let lineWidth: CGFloat = 4.5
  static let holdMs = 650
  static let fadeMs = 650
  static let glowRiseMs = 120.0
  static let glowFallMs = (350.0, 1100.0)
  static let glowWidth: CGFloat = 20
  static let glowBlur: CGFloat = 14
  static let glowOpacity = 0.45

  /// A lifted stroke's opacity `ageMs` after it lifted.
  static func alpha(ageMs: Int) -> Double {
    if ageMs <= holdMs { return 1 }
    let t = min(max(Double(ageMs - holdMs) / Double(fadeMs), 0), 1)
    return (1 - t) * (1 - t)
  }

  /// The edge glow's strength `ms` into the recording, 0 to 1.
  static func glow(ms: Double) -> Double {
    smoothstep(0, glowRiseMs, ms) * (1 - smoothstep(glowFallMs.0, glowFallMs.1, ms))
  }

  /// What shows `nowMs` into the recording: the live stroke whole, and
  /// each lifted stroke at its fade's opacity, faded ones left out.
  static func visible(_ recorder: AnnotateStrokeRecorder, nowMs: Int) -> [(
    stroke: AnnotateStroke, alpha: Double
  )] {
    var shown: [(stroke: AnnotateStroke, alpha: Double)] = []
    for stroke in recorder.finished {
      let opacity = Self.alpha(ageMs: nowMs - stroke.t1Ms)
      if opacity > 0 { shown.append((stroke, opacity)) }
    }
    if let live = recorder.live { shown.append((live, 1)) }
    return shown
  }

  /// Whether anything shows now or will without new input: the glow, the
  /// live stroke or a stroke still fading.
  static func animating(_ recorder: AnnotateStrokeRecorder, nowMs: Int) -> Bool {
    Double(nowMs) < glowFallMs.1 || !visible(recorder, nowMs: nowMs).isEmpty
  }

  private static func smoothstep(_ a: Double, _ b: Double, _ x: Double) -> Double {
    let t = min(max((x - a) / (b - a), 0), 1)
    return t * t * (3 - 2 * t)
  }
}
