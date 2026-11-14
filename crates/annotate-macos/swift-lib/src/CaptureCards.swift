// The cards a capture leaves in the corner of its display: the thumbnail
// with a shadow, a duration pill for recordings, round buttons on hover,
// a click that edits or opens, and a drag that carries the file out. The
// stack follows Hex (MIT, © 2026 Christopher Langton),
// `src/rune_ui/screenshot_thumbnail.rs`: newest in the bottom-right
// corner, 16 pt in, 12 pt apart. A card does nothing itself: every button
// posts a `card_action` event for the host. Main thread only.

import AppKit
import ImageIO

/// A round hover button with an SF Symbol.
final class CaptureCardButton: NSView {
  var action = CaptureCardAction.close
  var symbol = "xmark"
  var onPress: ((CaptureCardAction) -> Void)?

  override var isOpaque: Bool { false }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  /// Taken here, so the card under it starts no click or drag.
  override func mouseDown(with event: NSEvent) {}

  override func mouseUp(with event: NSEvent) {
    if bounds.contains(convert(event.locationInWindow, from: nil)) { onPress?(action) }
  }

  override func draw(_ dirtyRect: NSRect) {
    NSColor(white: 0.08, alpha: 0.78).setFill()
    NSBezierPath(ovalIn: bounds).fill()
    NSColor(white: 1, alpha: 0.2).setStroke()
    let rim = NSBezierPath(ovalIn: bounds.insetBy(dx: 0.5, dy: 0.5))
    rim.lineWidth = 1
    rim.stroke()
    let configuration = NSImage.SymbolConfiguration(
      pointSize: bounds.height * 0.42, weight: .semibold)
    guard
      let image = NSImage(systemSymbolName: symbol, accessibilityDescription: toolTip)?
        .withSymbolConfiguration(configuration),
      let context = NSGraphicsContext.current?.cgContext
    else {
      return
    }
    let size = image.size
    let frame = NSRect(
      x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2, width: size.width,
      height: size.height)
    // A white symbol: drawn, then filled over.
    context.saveGState()
    context.beginTransparencyLayer(auxiliaryInfo: nil)
    image.draw(in: frame)
    NSColor.white.setFill()
    frame.fill(using: .sourceAtop)
    context.endTransparencyLayer()
    context.restoreGState()
  }
}

/// One card: the thumbnail in a rounded rectangle inset by the shadow's
/// room, in AppKit's points (y up).
final class CaptureCardView: NSView, NSDraggingSource {
  var image: NSImage?
  /// The recording's length, or nil for a screenshot.
  var pill: String?
  var fileURL: URL?
  var onClick: (() -> Void)?
  var onDragged: (() -> Void)?
  var onHover: ((Bool) -> Void)?
  /// Every drag's end, whatever it dropped.
  var onDragEnded: (() -> Void)?
  /// A file drag from this card is under way.
  private(set) var dragging = false
  private var buttons: [CaptureCardButton] = []
  private var pressedAt: NSPoint?

  override var isOpaque: Bool { false }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  var cardRect: NSRect {
    bounds.insetBy(dx: CaptureCardLayout.shadow, dy: CaptureCardLayout.shadow)
  }

  /// The hover buttons: each action with its symbol and tooltip.
  func setButtons(
    _ items: [(action: CaptureCardAction, symbol: String, label: String)],
    onPress: @escaping (CaptureCardAction) -> Void
  ) {
    for button in buttons { button.removeFromSuperview() }
    buttons.removeAll()
    let card = cardRect
    for (action, rect) in CaptureCardLayout.buttons(items.map { $0.action }, size: card.size) {
      guard let item = items.first(where: { $0.action == action }) else { continue }
      let button = CaptureCardButton(frame: rect.offsetBy(dx: card.minX, dy: card.minY))
      button.action = action
      button.symbol = item.symbol
      button.toolTip = item.label
      button.onPress = onPress
      button.isHidden = true
      addSubview(button)
      buttons.append(button)
    }
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    for area in trackingAreas { removeTrackingArea(area) }
    let options: NSTrackingArea.Options = [.activeAlways, .mouseEnteredAndExited, .inVisibleRect]
    addTrackingArea(NSTrackingArea(rect: bounds, options: options, owner: self, userInfo: nil))
  }

  override func mouseEntered(with event: NSEvent) {
    hover(true)
  }

  override func mouseExited(with event: NSEvent) {
    hover(false)
  }

  private func hover(_ inside: Bool) {
    for button in buttons { button.isHidden = !inside }
    onHover?(inside)
  }

  override func mouseDown(with event: NSEvent) {
    pressedAt = convert(event.locationInWindow, from: nil)
    dragging = false
  }

  override func mouseDragged(with event: NSEvent) {
    guard !dragging, let start = pressedAt, let fileURL else { return }
    let point = convert(event.locationInWindow, from: nil)
    guard hypot(point.x - start.x, point.y - start.y) > 4 else { return }
    dragging = true
    let item = NSDraggingItem(pasteboardWriter: fileURL as NSURL)
    item.setDraggingFrame(cardRect, contents: image)
    _ = beginDraggingSession(with: [item], event: event, source: self)
  }

  override func mouseUp(with event: NSEvent) {
    let pressed = pressedAt != nil
    pressedAt = nil
    if pressed && !dragging { onClick?() }
  }

  func draggingSession(
    _ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext
  ) -> NSDragOperation {
    .copy
  }

  func draggingSession(
    _ session: NSDraggingSession, endedAt screenPoint: NSPoint, operation: NSDragOperation
  ) {
    dragging = false
    pressedAt = nil
    if !operation.isEmpty { onDragged?() }
    onDragEnded?()
  }

  override func draw(_ dirtyRect: NSRect) {
    let card = cardRect
    let radius = CaptureCardLayout.radius
    let path = NSBezierPath(roundedRect: card, xRadius: radius, yRadius: radius)
    NSGraphicsContext.saveGraphicsState()
    let shadow = NSShadow()
    shadow.shadowBlurRadius = 10
    shadow.shadowOffset = NSSize(width: 0, height: -2)
    shadow.shadowColor = NSColor(white: 0, alpha: 0.35)
    shadow.set()
    NSColor(white: 0.12, alpha: 1).setFill()
    path.fill()
    NSGraphicsContext.restoreGraphicsState()

    NSGraphicsContext.saveGraphicsState()
    path.addClip()
    image?.draw(in: card)
    NSGraphicsContext.restoreGraphicsState()
    NSColor(white: 1, alpha: 0.18).setStroke()
    path.lineWidth = 1
    path.stroke()

    guard let pill else { return }
    let attributes: [NSAttributedString.Key: Any] = [
      .font: NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .semibold),
      .foregroundColor: NSColor.white,
    ]
    let size = (pill as NSString).size(withAttributes: attributes)
    let box = NSRect(
      x: card.minX + 6, y: card.minY + 6, width: size.width.rounded(.up) + 12, height: 18)
    NSColor(white: 0, alpha: 0.62).setFill()
    NSBezierPath(roundedRect: box, xRadius: 9, yRadius: 9).fill()
    (pill as NSString).draw(
      at: NSPoint(x: box.minX + 6, y: box.midY - size.height / 2), withAttributes: attributes)
  }
}

/// A card's window: above normal windows, on every space, never in a
/// capture.
final class CaptureCardPanel: AnnotatePanel {
  init(frame: NSRect) {
    super.init(frame: frame, level: CaptureLevels.card)
    ignoresMouseEvents = false
  }
}

/// Every card on screen, at most `CaptureCardLayout.perDisplay` a display.
final class CaptureCards {
  static let shared = CaptureCards()
  static let tick: Double = 0.25

  private final class Card {
    let id: String
    let display: UInt32
    /// The display's visible frame the card stacks in.
    let area: CGRect
    let size: CGSize
    let panel: CaptureCardPanel
    let view: CaptureCardView
    var timer = CaptureCardTimer()
    var hovered = false
    /// Closed while its file was being dragged: it goes when the drag ends,
    /// so the drag never reaches a released view.
    var closeAfterDrag = false

    init(id: String, display: UInt32, area: CGRect, size: CGSize) {
      self.id = id
      self.display = display
      self.area = area
      self.size = size
      let shadow = CaptureCardLayout.shadow
      let frame = CGRect(origin: .zero, size: size).insetBy(dx: -shadow, dy: -shadow)
      panel = CaptureCardPanel(frame: frame)
      view = CaptureCardView(frame: NSRect(origin: .zero, size: frame.size))
      panel.contentView = view
    }
  }

  /// Oldest first, every display's.
  private var cards: [Card] = []
  private var timer: Timer?
  private var lastTick: Double = 0

  func show(_ request: CaptureCardRequest) {
    // Replaced once the new card is up, so the id's card never leaves.
    let replaced = cards.filter { $0.id == request.id }
    let screens = NSScreen.screens.compactMap { AnnotateScreen($0) }
    let chosen =
      screens.first(where: { $0.id == request.displayId })
      ?? AnnotateGeometry.screen(under: NSEvent.mouseLocation, in: screens)
    guard let screen = chosen else { return }
    let file = URL(fileURLWithPath: request.path)
    let picture =
      request.thumbnailPath.flatMap { Self.load(URL(fileURLWithPath: $0)) }
      ?? (request.kind == .video ? nil : Self.load(file))
    let size = CaptureCardLayout.cardSize(
      width: picture?.width ?? 1600, height: picture?.height ?? 1000)
    let card = Card(id: request.id, display: screen.id, area: screen.visibleFrame, size: size)
    if let picture {
      card.view.image = NSImage(
        cgImage: picture, size: NSSize(width: picture.width, height: picture.height))
    }
    card.view.fileURL = file
    if request.kind != .screenshot {
      card.view.pill = AnnotateMachine.clock(ms: request.durationMs ?? 0)
    }
    let labels = (request.labels ?? CaptureLabels()).card
    let saved = request.saved ?? true
    let saveSymbol = saved ? "folder" : "square.and.arrow.down"
    let saveLabel = saved ? labels.show : labels.save
    var items: [(action: CaptureCardAction, symbol: String, label: String)] = [
      (action: CaptureCardAction.copy, symbol: "doc.on.doc", label: labels.copy),
      (action: CaptureCardAction.save, symbol: saveSymbol, label: saveLabel),
    ]
    if request.kind == .screenshot {
      items.append((action: CaptureCardAction.edit, symbol: "pencil", label: labels.edit))
    }
    items.append((action: CaptureCardAction.close, symbol: "xmark", label: labels.close))
    let id = request.id
    card.view.setButtons(items) { [weak self] action in self?.act(id, action) }
    let click: CaptureCardAction = request.kind == .screenshot ? .edit : .open
    card.view.onClick = { [weak self] in self?.act(id, click) }
    card.view.onDragged = { [weak self] in self?.act(id, .dragged) }
    card.view.onHover = { [weak card] inside in card?.hovered = inside }
    card.view.onDragEnded = { [weak self, weak card] in
      guard let self, let card, card.closeAfterDrag else { return }
      self.remove(card)
      self.layout(display: card.display)
    }
    cards.append(card)
    for old in replaced { close(old) }
    let mine = cards.filter { $0.display == screen.id }
    for old in mine.dropLast(CaptureCardLayout.perDisplay) { close(old) }
    layout(display: screen.id)
    card.panel.orderFrontRegardless()
    startTimer()
  }

  func close(id: String) {
    guard let card = cards.first(where: { $0.id == id }) else { return }
    close(card)
  }

  func closeAll() {
    for card in cards { close(card) }
  }

  private func close(_ card: Card) {
    if card.view.dragging {
      card.closeAfterDrag = true
      return
    }
    remove(card)
    layout(display: card.display)
  }

  private func act(_ id: String, _ action: CaptureCardAction) {
    CaptureSession.shared.post(CaptureEvent.card(id, action))
    if action == .close { close(id: id) }
  }

  /// Every way a card leaves comes through here. `card_closed` goes out
  /// once, after the card is gone, unless a newer card with its id is up.
  private func remove(_ card: Card) {
    guard cards.contains(where: { $0 === card }) else { return }
    cards.removeAll { $0 === card }
    card.view.onClick = nil
    card.view.onDragged = nil
    card.view.onHover = nil
    card.view.onDragEnded = nil
    card.view.setButtons([]) { _ in }
    card.panel.orderOut(nil)
    card.panel.close()
    if cards.isEmpty {
      timer?.invalidate()
      timer = nil
    }
    if !cards.contains(where: { $0.id == card.id }) {
      CaptureSession.shared.post(CaptureEvent.closed(card.id))
    }
  }

  private func layout(display: UInt32) {
    let mine = cards.filter { $0.display == display }
    guard let area = mine.last?.area else { return }
    let shadow = CaptureCardLayout.shadow
    for (card, slot) in zip(mine, CaptureCardLayout.slots(mine.map { $0.size }, in: area)) {
      card.panel.setFrame(slot.insetBy(dx: -shadow, dy: -shadow), display: true)
    }
  }

  private func startTimer() {
    guard timer == nil else { return }
    lastTick = AnnotateHostClock.timebase.seconds(AnnotateHostClock.now())
    let timer = Timer(timeInterval: Self.tick, repeats: true) { [weak self] _ in self?.tickCards() }
    RunLoop.main.add(timer, forMode: .common)
    self.timer = timer
  }

  /// Cards whose time is up leave, the pointer on a card holding it, and
  /// so do the cards of a display that went away.
  private func tickCards() {
    let now = AnnotateHostClock.timebase.seconds(AnnotateHostClock.now())
    let elapsed = now - lastTick
    lastTick = now
    var expired: [Card] = []
    // A card whose file is being dragged out waits, as one under the
    // pointer does.
    for card in cards where !card.closeAfterDrag {
      if card.timer.tick(elapsed, hovered: card.hovered || card.view.dragging) {
        expired.append(card)
      }
    }
    for card in expired {
      remove(card)
      layout(display: card.display)
    }
    let displays = Set(NSScreen.screens.compactMap { AnnotateScreen($0)?.id })
    for card in cards where !displays.contains(card.display) { close(card) }
  }

  private static func load(_ url: URL) -> CGImage? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: 480,
    ]
    return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
  }
}
