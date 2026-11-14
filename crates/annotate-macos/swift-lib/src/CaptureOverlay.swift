// Capture's windows over the screen: the selector on every display (over
// a frozen picture for a screenshot, over the live screen for a
// recording), the countdown, and the outline around what records. The
// selector's look follows Hex (MIT, © 2026 Christopher Langton),
// `src/rune_ui/capture_capsule/picker.rs`: the dim, the window's tint and
// ring, the area's ring with its dark hairline, and the W × H badge. Main
// thread only; `CaptureSession` owns them and feeds them plain state.

import AppKit

enum CaptureLevels {
  /// Over other apps' windows and the menu bar, as Annotate's ink.
  static let selector = AnnotateLevels.ink
  static let outline = AnnotateLevels.ink
  static let countdown = AnnotateLevels.capsule
  /// Above normal windows, under menus.
  static let card = NSWindow.Level.floating
}

enum CaptureKeys {
  static let escape: UInt16 = 53
  static let space: UInt16 = 49
  static let returnKey: UInt16 = 36
  static let enter: UInt16 = 76
}

/// A panel that takes the keyboard without activating the app, so the
/// selector and the countdown hear Escape, Space and Return.
final class CaptureKeyPanel: AnnotatePanel {
  /// Every key down; the panel swallows them all.
  var onKey: ((UInt16) -> Void)?

  override var canBecomeKey: Bool { true }

  override func keyDown(with event: NSEvent) {
    onKey?(event.keyCode)
  }
}

/// Draws one display's part of the selector, in its top-left points.
final class CaptureSelectorView: NSView {
  var scene = CaptureScene.empty {
    didSet { if scene != oldValue { needsDisplay = true } }
  }
  var mode = CaptureSelectMode.area {
    didSet { if mode != oldValue { needsDisplay = true } }
  }
  var hints = CaptureHints(area: "", window: "")
  var onMouse: ((AnnotateMouse, CGPoint) -> Void)?
  var onMove: ((CGPoint) -> Void)?

  override var isFlipped: Bool { true }
  override var isOpaque: Bool { false }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    for area in trackingAreas { removeTrackingArea(area) }
    let options: NSTrackingArea.Options = [
      .activeAlways, .mouseEnteredAndExited, .mouseMoved, .inVisibleRect,
    ]
    addTrackingArea(NSTrackingArea(rect: bounds, options: options, owner: self, userInfo: nil))
  }

  override func mouseEntered(with event: NSEvent) {
    NSCursor.crosshair.set()
    onMove?(convert(event.locationInWindow, from: nil))
  }

  override func mouseMoved(with event: NSEvent) {
    NSCursor.crosshair.set()
    onMove?(convert(event.locationInWindow, from: nil))
  }

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
    let target = scene.target
    let hole: CGRect?
    switch scene.kind {
    case .nothing: hole = nil
    case .area, .window, .display: hole = target
    }

    context.saveGState()
    context.setFillColor(CGColor(gray: 0, alpha: CaptureLook.dim))
    context.addRect(bounds)
    if let hole { context.addPath(holePath(hole)) }
    context.fillPath(using: .evenOdd)
    if let hole {
      // Nearly clear, so the hole still takes the pointer.
      context.setFillColor(CGColor(gray: 0, alpha: 0.004))
      context.addPath(holePath(hole))
      context.fillPath()
    }
    context.restoreGState()

    let accent = NSColor.controlAccentColor
    switch scene.kind {
    case .nothing:
      break
    case .window, .display:
      let path = holePath(target)
      context.saveGState()
      context.setFillColor(accent.withAlphaComponent(CaptureLook.windowTint).cgColor)
      context.addPath(path)
      context.fillPath()
      context.setStrokeColor(accent.cgColor)
      context.setLineWidth(CaptureLook.windowRing)
      let inset = CaptureLook.windowRing / 2
      context.addPath(holePath(target.insetBy(dx: inset, dy: inset)))
      context.strokePath()
      context.restoreGState()
    case .area:
      let edge = CaptureLook.areaEdge
      let ring = CaptureLook.areaRing
      context.saveGState()
      context.setStrokeColor(CGColor(gray: 0, alpha: 0.6))
      context.setLineWidth(edge)
      context.stroke(target.insetBy(dx: -ring - edge / 2, dy: -ring - edge / 2))
      context.setStrokeColor(CGColor(gray: 1, alpha: 1))
      context.setLineWidth(ring)
      context.stroke(target.insetBy(dx: -ring / 2, dy: -ring / 2))
      context.restoreGState()
    }

    if let badge = scene.badge { drawBadge(badge) }
    if scene.kind != .area {
      drawHint(mode == .area ? hints.area : hints.window)
    }
  }

  /// A window's rounded corners; an area's and a display's square ones.
  private func holePath(_ rect: CGRect) -> CGPath {
    guard !rect.isNull, !rect.isEmpty else { return CGPath(rect: .zero, transform: nil) }
    guard scene.kind == .window else { return CGPath(rect: rect, transform: nil) }
    let radius = max(min(CaptureLook.windowRadius, rect.width / 2, rect.height / 2), 0)
    return CGPath(
      roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
  }

  private func textAttributes(size: CGFloat) -> [NSAttributedString.Key: Any] {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineBreakMode = .byTruncatingTail
    return [
      .font: NSFont.monospacedDigitSystemFont(ofSize: size, weight: .medium),
      .foregroundColor: NSColor.white, .paragraphStyle: paragraph,
    ]
  }

  private func drawBadge(_ text: String) {
    let attributes = textAttributes(size: 12)
    let padding = CaptureLook.badgePadding
    let textSize = (text as NSString).size(withAttributes: attributes)
    let width = min(textSize.width.rounded(.up) + 2 * padding, CaptureLook.badgeMaxWidth)
    let size = CGSize(width: width, height: CaptureLook.badgeHeight)
    let pointer = scene.kind == .area ? scene.pointer : nil
    let origin = CaptureGeometry.placeBadge(
      target: scene.target, badge: size, display: bounds.size, pointer: pointer)
    let rect = CGRect(origin: origin, size: size)
    NSColor(white: 0.08, alpha: 0.82).setFill()
    NSBezierPath(roundedRect: rect, xRadius: 6, yRadius: 6).fill()
    let textRect = rect.insetBy(dx: padding, dy: (rect.height - textSize.height) / 2)
    (text as NSString).draw(in: textRect, withAttributes: attributes)
  }

  /// The hint, centred a quarter up from the display's bottom.
  private func drawHint(_ text: String) {
    guard !text.isEmpty else { return }
    let attributes = textAttributes(size: 13)
    let textSize = (text as NSString).size(withAttributes: attributes)
    let width = min(textSize.width.rounded(.up) + 28, bounds.width - 32)
    let height: CGFloat = 32
    let rect = CGRect(
      x: ((bounds.width - width) / 2).rounded(), y: (bounds.height * 0.75).rounded(),
      width: width, height: height)
    NSColor(white: 0.08, alpha: 0.82).setFill()
    NSBezierPath(roundedRect: rect, xRadius: height / 2, yRadius: height / 2).fill()
    let textRect = rect.insetBy(dx: 14, dy: (height - textSize.height) / 2)
    (text as NSString).draw(in: textRect, withAttributes: attributes)
  }
}

/// The selector across every display: one key-taking panel per display,
/// the pure `CaptureSelector` deciding, `finish` closing everything once.
final class CaptureSelectorController {
  private struct Shown {
    var id: UInt32
    var panel: CaptureKeyPanel
    var view: CaptureSelectorView
  }

  private var selector: CaptureSelector
  private let hints: CaptureHints
  private var shown: [Shown] = []
  private var monitors: [Any] = []
  private var completion: ((CaptureSelection) -> Void)?

  init(selector: CaptureSelector, hints: CaptureHints) {
    self.selector = selector
    self.hints = hints
  }

  /// One panel per display, over `image` when the display was frozen.
  func show(
    _ screens: [(screen: AnnotateScreen, image: CGImage?)],
    completion: @escaping (CaptureSelection) -> Void
  ) {
    self.completion = completion
    for (screen, image) in screens {
      let panel = CaptureKeyPanel(frame: screen.frame, level: CaptureLevels.selector)
      panel.ignoresMouseEvents = false
      panel.acceptsMouseMovedEvents = true
      let bounds = NSRect(origin: .zero, size: screen.frame.size)
      let container = NSView(frame: bounds)
      if let image {
        let picture = NSImageView(frame: bounds)
        picture.image = NSImage(cgImage: image, size: screen.frame.size)
        picture.imageScaling = .scaleAxesIndependently
        container.addSubview(picture)
      }
      let view = CaptureSelectorView(frame: bounds)
      view.hints = hints
      view.mode = selector.mode
      let id = screen.id
      view.onMouse = { [weak self] kind, point in self?.mouse(kind, point, on: id) }
      view.onMove = { [weak self] point in self?.moved(point, on: id) }
      container.addSubview(view)
      panel.contentView = container
      panel.onKey = { [weak self] key in self?.key(key) }
      shown.append(Shown(id: id, panel: panel, view: view))
      panel.orderFrontRegardless()
    }
    let mouse = NSEvent.mouseLocation
    if let under = screens.first(where: { AnnotateGeometry.contains(mouse, $0.screen) }) {
      selector.moved(AnnotateGeometry.local(mouse, on: under.screen), on: under.screen.id)
    }
    let front = shown.first { $0.id == selector.pointer?.display } ?? shown.first
    front?.panel.makeKey()
    // The panels hear keys while one of them is key; Escape also reaches
    // a global monitor while the app may monitor keys (Accessibility).
    if let monitor = NSEvent.addGlobalMonitorForEvents(
      matching: .keyDown,
      handler: { [weak self] event in
        if event.keyCode == CaptureKeys.escape { self?.finish(.cancelled) }
      })
    {
      monitors.append(monitor)
    }
    let local = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
      guard let self, self.completion != nil else { return event }
      self.key(event.keyCode)
      return nil
    }
    if let local { monitors.append(local) }
    refresh()
  }

  /// Closes every panel and answers once; later calls do nothing.
  func finish(_ selection: CaptureSelection) {
    guard let completion else { return }
    self.completion = nil
    for monitor in monitors { NSEvent.removeMonitor(monitor) }
    monitors.removeAll()
    for item in shown {
      item.view.onMouse = nil
      item.view.onMove = nil
      item.panel.onKey = nil
      item.panel.orderOut(nil)
      item.panel.close()
    }
    shown.removeAll()
    NSCursor.arrow.set()
    completion(selection)
  }

  private func key(_ code: UInt16) {
    guard completion != nil else { return }
    switch code {
    case CaptureKeys.escape:
      finish(.cancelled)
    case CaptureKeys.space:
      selector.toggleMode()
      refresh()
    case CaptureKeys.returnKey, CaptureKeys.enter:
      if let selection = selector.returnKey() { finish(selection) }
    default:
      break
    }
  }

  private func moved(_ point: CGPoint, on display: UInt32) {
    guard completion != nil else { return }
    selector.moved(point, on: display)
    refresh()
  }

  private func mouse(_ kind: AnnotateMouse, _ point: CGPoint, on display: UInt32) {
    guard completion != nil else { return }
    switch kind {
    case .down:
      selector.down(point, on: display)
    case .dragged:
      selector.dragged(point)
    case .up:
      if let selection = selector.up(point) {
        finish(selection)
        return
      }
    }
    refresh()
  }

  private func refresh() {
    for item in shown {
      item.view.mode = selector.mode
      item.view.scene = selector.scene(on: item.id)
    }
  }
}

// MARK: Countdown

final class CaptureCountdownView: NSView {
  var number = 3 {
    didSet { if number != oldValue { needsDisplay = true } }
  }

  override var isOpaque: Bool { false }

  override func draw(_ dirtyRect: NSRect) {
    NSColor(white: 0.08, alpha: 0.88).setFill()
    NSBezierPath(roundedRect: bounds, xRadius: 28, yRadius: 28).fill()
    let attributes: [NSAttributedString.Key: Any] = [
      .font: NSFont.monospacedDigitSystemFont(ofSize: 64, weight: .semibold),
      .foregroundColor: NSColor.white,
    ]
    let text = "\(number)" as NSString
    let size = text.size(withAttributes: attributes)
    text.draw(
      at: NSPoint(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2),
      withAttributes: attributes)
  }
}

/// 3, 2, 1 in the middle of the recorded display; Escape cancels.
final class CaptureCountdown {
  static let size = CGSize(width: 140, height: 140)

  private let panel: CaptureKeyPanel
  private let view: CaptureCountdownView
  private var remaining: Int
  private var timer: Timer?
  private var monitors: [Any] = []
  private var completion: ((Bool) -> Void)?

  /// `completion` gets true when the count ran out, false when cancelled.
  init(screen: AnnotateScreen, seconds: Int, completion: @escaping (Bool) -> Void) {
    let size = Self.size
    let frame = CGRect(
      x: (screen.frame.midX - size.width / 2).rounded(),
      y: (screen.frame.midY - size.height / 2).rounded(), width: size.width,
      height: size.height)
    panel = CaptureKeyPanel(frame: frame, level: CaptureLevels.countdown)
    view = CaptureCountdownView(frame: NSRect(origin: .zero, size: size))
    remaining = max(seconds, 1)
    self.completion = completion
    view.number = remaining
    panel.contentView = view
    panel.ignoresMouseEvents = true
  }

  func start() {
    panel.onKey = { [weak self] key in
      if key == CaptureKeys.escape { self?.finish(false) }
    }
    if let monitor = NSEvent.addGlobalMonitorForEvents(
      matching: .keyDown,
      handler: { [weak self] event in
        if event.keyCode == CaptureKeys.escape { self?.finish(false) }
      })
    {
      monitors.append(monitor)
    }
    let local = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
      guard event.keyCode == CaptureKeys.escape, let self else { return event }
      self.finish(false)
      return nil
    }
    if let local { monitors.append(local) }
    panel.orderFrontRegardless()
    panel.makeKey()
    let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
    RunLoop.main.add(timer, forMode: .common)
    self.timer = timer
  }

  /// Closes the panel and answers once.
  func finish(_ ranOut: Bool) {
    guard let completion else { return }
    self.completion = nil
    timer?.invalidate()
    timer = nil
    for monitor in monitors { NSEvent.removeMonitor(monitor) }
    monitors.removeAll()
    panel.onKey = nil
    panel.orderOut(nil)
    panel.close()
    completion(ranOut)
  }

  private func tick() {
    remaining -= 1
    if remaining <= 0 {
      finish(true)
    } else {
      view.number = remaining
    }
  }
}

// MARK: Outline

final class CaptureOutlineView: NSView {
  override var isOpaque: Bool { false }

  override func draw(_ dirtyRect: NSRect) {
    let red = NSColor(
      srgbRed: AnnotateInkLook.red.r, green: AnnotateInkLook.red.g,
      blue: AnnotateInkLook.red.b, alpha: 1)
    red.setStroke()
    let ring = CaptureLook.outline
    let path = NSBezierPath(rect: bounds.insetBy(dx: ring / 2, dy: ring / 2))
    path.lineWidth = ring
    path.stroke()
  }
}

/// The ring just outside what records; the pointer passes through it.
final class CaptureOutlinePanel: AnnotatePanel {
  init(region: CGRect, on screen: AnnotateScreen) {
    let frame = CaptureGeometry.outlineFrame(region, on: screen)
    super.init(frame: frame, level: CaptureLevels.outline)
    ignoresMouseEvents = true
    contentView = CaptureOutlineView(frame: NSRect(origin: .zero, size: frame.size))
  }
}
