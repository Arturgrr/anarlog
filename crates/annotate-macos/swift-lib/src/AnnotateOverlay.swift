// The ink overlay over the recorded display and the recording capsule
// above it: borderless, non-activating panels left out of screen
// recordings, as Hex's (MIT, © 2026 Christopher Langton) ink overlay and
// capsule are (`src/rune_ui/capture_capsule/ink.rs`, `mod.rs`). Main
// thread only; `AnnotateSession` owns them and feeds them plain state.

import AppKit
import QuartzCore

enum AnnotateLevels {
  /// Over other apps' windows and the menu bar (`NSStatusWindowLevel`, 25).
  static let ink = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)
  /// The capsule stays clickable above the ink.
  static let capsule = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 2)
}

/// A panel that never takes focus or activates the app, on every space,
/// never in screen recordings.
class AnnotatePanel: NSPanel {
  init(frame: NSRect, level: NSWindow.Level) {
    super.init(
      contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
      defer: false)
    // Setting `isFloatingPanel` resets the level, so it goes first.
    isFloatingPanel = true
    self.level = level
    hidesOnDeactivate = false
    isOpaque = false
    backgroundColor = .clear
    hasShadow = false
    sharingType = .none
    isReleasedWhenClosed = false
    animationBehavior = .none
    collectionBehavior = [
      .canJoinAllSpaces, .canJoinAllApplications, .fullScreenAuxiliary, .stationary, .ignoresCycle,
    ]
  }

  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }

  /// Reaches over the menu bar.
  override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
    frameRect
  }
}

/// What the ink view draws: strokes in the display's top-left points with
/// their opacity, and the edge glow's strength.
struct AnnotateInkScene {
  var strokes: [(points: [CGPoint], alpha: Double)] = []
  var glow: Double = 0

  var isEmpty: Bool { strokes.isEmpty && glow <= 0 }
}

enum AnnotateMouse {
  case down
  case dragged
  case up
}

final class AnnotateInkView: NSView {
  var scene = AnnotateInkScene()
  /// Mouse events in the display's top-left points.
  var onMouse: ((AnnotateMouse, CGPoint) -> Void)?

  override var isFlipped: Bool { true }
  override var isOpaque: Bool { false }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func mouseDown(with event: NSEvent) {
    onMouse?(.down, convert(event.locationInWindow, from: nil))
  }

  override func mouseDragged(with event: NSEvent) {
    onMouse?(.dragged, convert(event.locationInWindow, from: nil))
  }

  override func mouseUp(with event: NSEvent) {
    onMouse?(.up, convert(event.locationInWindow, from: nil))
  }

  override func draw(_ dirtyRect: NSRect) {
    guard let context = NSGraphicsContext.current?.cgContext else { return }
    context.clear(bounds)
    let (r, g, b) = (AnnotateInkLook.red.r, AnnotateInkLook.red.g, AnnotateInkLook.red.b)
    if scene.glow > 0 {
      let alpha = AnnotateInkLook.glowOpacity * scene.glow
      let color = CGColor(srgbRed: r, green: g, blue: b, alpha: alpha)
      context.saveGState()
      context.setShadow(offset: .zero, blur: AnnotateInkLook.glowBlur, color: color)
      context.setStrokeColor(color)
      context.setLineWidth(AnnotateInkLook.glowWidth)
      context.stroke(bounds)
      context.restoreGState()
    }
    context.setLineCap(.round)
    context.setLineJoin(.round)
    context.setLineWidth(AnnotateInkLook.lineWidth)
    for stroke in scene.strokes {
      let color = CGColor(srgbRed: r, green: g, blue: b, alpha: stroke.alpha)
      guard let first = stroke.points.first else { continue }
      if stroke.points.count == 1 {
        let (radius, side) = (AnnotateInkLook.lineWidth / 2, AnnotateInkLook.lineWidth)
        let dot = CGRect(x: first.x - radius, y: first.y - radius, width: side, height: side)
        context.setFillColor(color)
        context.fillEllipse(in: dot)
        continue
      }
      // Through the midpoints, each point a control point: smooth, and on
      // the pointer's path.
      let path = CGMutablePath()
      path.move(to: first)
      let points = stroke.points
      for index in 1..<points.count - 1 {
        let (point, next) = (points[index], points[index + 1])
        path.addQuadCurve(
          to: CGPoint(x: (point.x + next.x) / 2, y: (point.y + next.y) / 2), control: point)
      }
      path.addLine(to: points[points.count - 1])
      context.setStrokeColor(color)
      context.addPath(path)
      context.strokePath()
    }
  }
}

/// The ink overlay: covers the recorded display, click-through unless ink
/// is on.
final class AnnotateInkPanel: AnnotatePanel {
  let inkView: AnnotateInkView

  init(screen: AnnotateScreen) {
    inkView = AnnotateInkView(frame: NSRect(origin: .zero, size: screen.frame.size))
    super.init(frame: screen.frame, level: AnnotateLevels.ink)
    ignoresMouseEvents = true
    contentView = inkView
  }

  /// Ink takes the pointer, so clicks don't reach the app underneath.
  func takesPointer(_ takes: Bool) {
    ignoresMouseEvents = !takes
  }
}

final class AnnotateCapsuleView: NSView {
  var clock = "0:00" {
    didSet { if clock != oldValue { needsDisplay = true } }
  }
  var asking = false {
    didSet { if asking != oldValue { needsDisplay = true } }
  }
  var penOn = false {
    didSet { if penOn != oldValue { needsDisplay = true } }
  }
  /// Capture's recording has no pen.
  var showsPen = true {
    didSet { if showsPen != oldValue { needsDisplay = true } }
  }
  var labels = AnnotateLabels()
  var onAction: ((AnnotateCapsuleTarget) -> Void)?

  override var isOpaque: Bool { false }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func mouseDown(with event: NSEvent) {
    let layout = AnnotateCapsuleLayout.make(asking: asking, pen: showsPen)
    if let target = layout.target(at: convert(event.locationInWindow, from: nil)) {
      onAction?(target)
    }
  }

  override func draw(_ dirtyRect: NSRect) {
    let layout = AnnotateCapsuleLayout.make(asking: asking, pen: showsPen)
    let red = NSColor(
      srgbRed: AnnotateInkLook.red.r, green: AnnotateInkLook.red.g,
      blue: AnnotateInkLook.red.b, alpha: 1)
    let radius = bounds.height / 2
    NSColor(white: 0.08, alpha: 0.88).setFill()
    NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius).fill()
    NSColor(white: 1, alpha: 0.14).setStroke()
    let rim = NSBezierPath(
      roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: radius - 0.5,
      yRadius: radius - 0.5)
    rim.lineWidth = 1
    rim.stroke()

    if asking {
      text(
        labels.discardQuestion, in: layout.question, color: .white, weight: .medium,
        center: false)
      for (target, rect) in layout.targets {
        let fill = target == .confirmDiscard ? red : NSColor(white: 1, alpha: 0.16)
        fill.setFill()
        NSBezierPath(roundedRect: rect, xRadius: 7, yRadius: 7).fill()
        let label = target == .confirmDiscard ? labels.discard : labels.keep
        text(label, in: rect, color: .white, weight: .semibold, center: true)
      }
      return
    }

    red.setFill()
    NSBezierPath(ovalIn: layout.dot).fill()
    text(clock, in: layout.clock, color: .white, weight: .medium, center: false)
    NSColor(white: 1, alpha: 0.2).setFill()
    layout.divider.fill()
    for (target, rect) in layout.targets {
      switch target {
      case .pen:
        if penOn {
          red.setFill()
          NSBezierPath(roundedRect: rect, xRadius: 7, yRadius: 7).fill()
        }
        symbol("pencil.tip", in: rect)
      case .stop:
        NSColor.white.setFill()
        let square = NSRect(x: rect.midX - 5, y: rect.midY - 5, width: 10, height: 10)
        NSBezierPath(roundedRect: square, xRadius: 2, yRadius: 2).fill()
      case .discard:
        NSColor.white.setStroke()
        let cross = NSBezierPath()
        cross.lineWidth = 1.8
        cross.lineCapStyle = .round
        cross.move(to: NSPoint(x: rect.midX - 5, y: rect.midY - 5))
        cross.line(to: NSPoint(x: rect.midX + 5, y: rect.midY + 5))
        cross.move(to: NSPoint(x: rect.midX - 5, y: rect.midY + 5))
        cross.line(to: NSPoint(x: rect.midX + 5, y: rect.midY - 5))
        cross.stroke()
      case .confirmDiscard, .keep:
        break
      }
    }
  }

  private func text(
    _ string: String, in rect: NSRect, color: NSColor, weight: NSFont.Weight, center: Bool
  ) {
    let font = NSFont.monospacedDigitSystemFont(ofSize: 13, weight: weight)
    let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
    let size = (string as NSString).size(withAttributes: attributes)
    let x = center ? rect.midX - size.width / 2 : rect.minX
    (string as NSString).draw(
      at: NSPoint(x: x, y: rect.midY - size.height / 2), withAttributes: attributes)
  }

  /// A white SF Symbol, tinted by filling over it.
  private func symbol(_ name: String, in rect: NSRect) {
    let configuration = NSImage.SymbolConfiguration(pointSize: 13, weight: .semibold)
    guard
      let image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
        .withSymbolConfiguration(configuration),
      let context = NSGraphicsContext.current?.cgContext
    else {
      return
    }
    let size = image.size
    let frame = NSRect(
      x: rect.midX - size.width / 2, y: rect.midY - size.height / 2, width: size.width,
      height: size.height)
    context.saveGState()
    context.beginTransparencyLayer(auxiliaryInfo: nil)
    image.draw(in: frame)
    NSColor.white.setFill()
    frame.fill(using: .sourceAtop)
    context.endTransparencyLayer()
    context.restoreGState()
  }
}

/// The recording capsule at the top of the recorded display.
final class AnnotateCapsulePanel: AnnotatePanel {
  let capsuleView: AnnotateCapsuleView

  init(screen: AnnotateScreen, labels: AnnotateLabels) {
    let size = AnnotateCapsuleLayout.size
    capsuleView = AnnotateCapsuleView(frame: NSRect(origin: .zero, size: size))
    capsuleView.labels = labels
    let origin = AnnotateCapsuleLayout.origin(on: screen)
    super.init(frame: NSRect(origin: origin, size: size), level: AnnotateLevels.capsule)
    ignoresMouseEvents = false
    contentView = capsuleView
  }
}
