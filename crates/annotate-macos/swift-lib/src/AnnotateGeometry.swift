// Where things go on the recorded display, as pure geometry over the
// display's metrics. The video size follows Hex (MIT, © 2026 Christopher
// Langton), `crates/capture-core/src/plan.rs` `output_size`; the capsule's
// place under the menu bar or the notch follows `HudPlacement` here.

import CoreGraphics
import Foundation

/// One display as `NSScreen` describes it, in AppKit's global points (y up,
/// from the primary display's bottom-left corner).
struct AnnotateScreen: Equatable {
  /// `CGDirectDisplayID`, as ScreenCaptureKit's `SCDisplay.displayID`.
  var id: UInt32
  var frame: CGRect
  var visibleFrame: CGRect
  /// `safeAreaInsets.top`: the notch's height, 0 on a flat display.
  var safeTop: CGFloat
  /// `backingScaleFactor`.
  var scale: CGFloat
}

enum AnnotateGeometry {
  /// The display under `point`, global points. A point on the line two
  /// displays share belongs to the one right of or below it; a point on no
  /// display gets the first (the main display), nil when there are none.
  static func screen(under point: CGPoint, in screens: [AnnotateScreen]) -> AnnotateScreen? {
    screens.first { contains(point, $0) } ?? screens.first
  }

  /// Whether `point` is on `screen`: its left and top edges in, its right
  /// and bottom edges out, as AppKit reports the pointer.
  static func contains(_ point: CGPoint, _ screen: AnnotateScreen) -> Bool {
    let frame = screen.frame
    return point.x >= frame.minX && point.x < frame.maxX && point.y > frame.minY
      && point.y <= frame.maxY
  }

  /// A global point in `screen`'s points from its top-left corner, where
  /// strokes and frames are measured.
  static func local(_ point: CGPoint, on screen: AnnotateScreen) -> CGPoint {
    CGPoint(x: point.x - screen.frame.minX, y: screen.frame.maxY - point.y)
  }

  /// The encoded size of `points` at `scale` pixels per point: the long
  /// edge at most `longEdge` pixels, never above the display's own pixels,
  /// both sides even. Nil for an empty size.
  static func pixelSize(points: CGSize, scale: CGFloat, longEdge: Int) -> (
    width: Int, height: Int
  )? {
    let (width, height) = (Double(points.width), Double(points.height))
    guard width.isFinite, height.isFinite, width > 0, height > 0 else { return nil }
    let native = scale.isFinite && scale > 0 ? Double(scale) : 1
    let factor = min(Double(longEdge) / max(width, height), native)
    func side(_ points: Double) -> Int {
      let pixels = (points * factor).rounded()
      guard pixels.isFinite, pixels < Double(Int32.max) else { return 2 }
      return max(Int(pixels) & ~1, 2)
    }
    return (side(width), side(height))
  }
}

enum AnnotateCapsuleTarget: Equatable {
  case pen
  case stop
  case discard
  case confirmDiscard
  case keep
}

/// The recording capsule: `● 0:07 ✎ │ ■ ✕`, or `Discard? [Discard] [Keep]`
/// while it asks, in a capsule of one size, its origin bottom-left (y up).
struct AnnotateCapsuleLayout {
  static let size = CGSize(width: 216, height: 36)
  /// The gap under the menu bar, or under the notch where there is one.
  static let topOffset: CGFloat = 8
  static let padding: CGFloat = 10
  /// The ✕ sits closer to the edge than the text does.
  static let trailing: CGFloat = 8
  static let button: CGFloat = 28
  static let gap: CGFloat = 4

  var dot: CGRect
  var clock: CGRect
  var divider: CGRect
  var question: CGRect
  /// The buttons that show, front to back.
  var targets: [(AnnotateCapsuleTarget, CGRect)]

  /// Without the pen (Capture's recording) the clock takes its place.
  static func make(asking: Bool, pen: Bool = true) -> AnnotateCapsuleLayout {
    let (width, height) = (size.width, size.height)
    let buttonY = (height - button) / 2
    func square(_ x: CGFloat) -> CGRect {
      CGRect(x: x, y: buttonY, width: button, height: button)
    }
    if asking {
      let keep = CGRect(x: width - padding - 52, y: buttonY, width: 52, height: button)
      let discard = CGRect(x: keep.minX - gap - 68, y: buttonY, width: 68, height: button)
      let question = CGRect(
        x: padding, y: 0, width: discard.minX - gap - padding, height: height)
      return AnnotateCapsuleLayout(
        dot: .zero, clock: .zero, divider: .zero, question: question,
        targets: [(.confirmDiscard, discard), (.keep, keep)])
    }
    let discard = square(width - trailing - button)
    let stop = square(discard.minX - gap - button)
    let divider = CGRect(x: stop.minX - 6 - 1, y: (height - 16) / 2, width: 1, height: 16)
    let dot = CGRect(x: padding + 2, y: (height - 8) / 2, width: 8, height: 8)
    guard pen else {
      let clock = CGRect(
        x: dot.maxX + 6, y: 0, width: divider.minX - 6 - dot.maxX - 6, height: height)
      return AnnotateCapsuleLayout(
        dot: dot, clock: clock, divider: divider, question: .zero,
        targets: [(.stop, stop), (.discard, discard)])
    }
    let pen = square(divider.minX - 6 - button)
    let clock = CGRect(x: dot.maxX + 6, y: 0, width: pen.minX - 4 - dot.maxX - 6, height: height)
    return AnnotateCapsuleLayout(
      dot: dot, clock: clock, divider: divider, question: .zero,
      targets: [(.pen, pen), (.stop, stop), (.discard, discard)])
  }

  /// The button under `point`, in the capsule's points.
  func target(at point: CGPoint) -> AnnotateCapsuleTarget? {
    targets.first { $0.1.contains(point) }?.0
  }

  /// The capsule's bottom-left corner on `screen`: centred, `topOffset`
  /// under the menu bar, or under the notch where a full-screen space hides
  /// the menu bar.
  static func origin(on screen: AnnotateScreen) -> CGPoint {
    let top = min(screen.visibleFrame.maxY, screen.frame.maxY - screen.safeTop) - topOffset
    return CGPoint(x: (screen.frame.midX - size.width / 2).rounded(), y: top - size.height)
  }
}
