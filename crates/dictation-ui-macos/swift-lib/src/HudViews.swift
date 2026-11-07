import AppKit
import Metal
import QuartzCore

enum HudLayout {
  /// Hex's HUD window on macOS: room for the scope's widest plate and its
  /// drop shadow, with the plate in the middle.
  static let scopeSize = NSSize(width: 320, height: 128)
  /// Wide enough for the live text plate under the HUD (Hex's live text
  /// overlay is 560 pt wide).
  static let panelWidth: CGFloat = 560
  /// The plate's gap under the menu bar: as close as it sits and still reads
  /// as its own thing.
  static let topOffset: CGFloat = 6
  static let liveTextGap: CGFloat = 6
  static let liveTextHeight: CGFloat = 32
  static let liveTextPadding: CGFloat = 14
  static let liveTextMaxWidth = panelWidth - 8
  /// How often a shown HUD moves to the screen under the pointer.
  static let followInterval: TimeInterval = 0.25
  /// `NSStatusWindowLevel`, as Hex's.
  static let level = NSWindow.Level(rawValue: 25)

  static var panelSize: NSSize { NSSize(width: panelWidth, height: scopeSize.height) }

  /// Below the menu bar on `frame`'s screen, horizontally centred: the plate's
  /// top 6 pt under the menu bar, or under the notch where a full-screen
  /// space hides the menu bar.
  static func panelOrigin(frame: NSRect, visibleFrame: NSRect, safeTop: CGFloat) -> NSPoint {
    let plateTop = min(visibleFrame.maxY, frame.maxY - safeTop) - topOffset
    let plateMiddle = plateTop - CGFloat(HudTuning.height) / 2
    return NSPoint(x: frame.midX - panelWidth / 2, y: plateMiddle - scopeSize.height / 2)
  }

  /// The live text plate's top edge in the panel (y up), `liveTextGap` past
  /// the HUD's plate.
  static var liveTextTop: CGFloat {
    scopeSize.height / 2 - CGFloat(HudTuning.height) / 2 - liveTextGap
  }
}

/// A click-through panel that never takes focus, over other apps' windows
/// and on every space.
final class HudPanel: NSPanel {
  init() {
    super.init(
      contentRect: NSRect(origin: .zero, size: HudLayout.panelSize),
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false)
    level = HudLayout.level
    isFloatingPanel = true
    hidesOnDeactivate = false
    isOpaque = false
    backgroundColor = .clear
    hasShadow = false
    ignoresMouseEvents = true
    sharingType = .none
    isReleasedWhenClosed = false
    animationBehavior = .none
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
  }

  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }

  /// The HUD's window reaches over the menu bar, as Hex's does.
  override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
    frameRect
  }
}

/// A view backed by the `CAMetalLayer` the scope draws into.
final class HudMetalView: NSView {
  var metalLayer: CAMetalLayer {
    // swiftlint:disable:next force_cast
    layer as! CAMetalLayer
  }

  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    layerContentsRedrawPolicy = .never
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func makeBackingLayer() -> CALayer {
    let layer = CAMetalLayer()
    layer.pixelFormat = .bgra8Unorm
    layer.isOpaque = false
    layer.framebufferOnly = true
    layer.colorspace = CGColorSpace(name: CGColorSpace.sRGB)
    return layer
  }

  override var isOpaque: Bool { false }

  override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    fitDrawable()
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    fitDrawable()
  }

  func fitDrawable() {
    let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
    metalLayer.contentsScale = scale
    metalLayer.drawableSize = CGSize(
      width: (bounds.width * scale).rounded(), height: (bounds.height * scale).rounded())
  }
}

/// Hex's live text plate (Labs): one line under the HUD with what the
/// dictation has said so far. The newest words stay in view; the start gives
/// way with "…".
final class HudLiveTextView: NSView {
  private let label = NSTextField(labelWithString: "")

  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    layer?.cornerRadius = HudLayout.liveTextHeight / 2
    label.lineBreakMode = .byTruncatingHead
    label.maximumNumberOfLines = 1
    label.usesSingleLineMode = true
    label.cell?.truncatesLastVisibleLine = true
    addSubview(label)
    isHidden = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  /// Shows `stable` then `tentative` centred on `centerX`, or hides the
  /// plate when there are no words.
  func show(stable: String, tentative: String, dark: Bool, centerX: CGFloat, scale: CGFloat) {
    let stable = stable.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !stable.isEmpty || !tentative.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      isHidden = true
      return
    }
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineBreakMode = .byTruncatingHead
    let text = NSMutableAttributedString(
      string: stable,
      attributes: [
        .font: Self.font, .foregroundColor: Self.textBase(dark: dark), .paragraphStyle: paragraph,
      ])
    text.append(
      NSAttributedString(
        string: stable.isEmpty ? tentative.trimmingCharacters(in: .whitespaces) : tentative,
        attributes: [
          .font: Self.font, .foregroundColor: Self.textFaint, .paragraphStyle: paragraph,
        ]))
    label.attributedStringValue = text
    let padding = HudLayout.liveTextPadding
    let width = min(ceil(text.size().width) + 2 + padding * 2, HudLayout.liveTextMaxWidth)
    let height = HudLayout.liveTextHeight
    frame = NSRect(
      x: (centerX - width / 2).rounded(), y: HudLayout.liveTextTop - height, width: width,
      height: height)
    let labelHeight = ceil(label.fittingSize.height)
    label.frame = NSRect(
      x: padding, y: ((height - labelHeight) / 2).rounded(), width: width - padding * 2,
      height: labelHeight)
    layer?.backgroundColor =
      dark ? CGColor(srgbRed: 0x19 / 255, green: 0x19 / 255, blue: 0x19 / 255, alpha: 1) : .white
    layer?.borderColor =
      dark
      ? CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.16)
      : CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 0.12)
    layer?.borderWidth = 1 / max(scale, 1)
    isHidden = false
  }

  /// `--text-base` from the graphite design tokens.
  private static func textBase(dark: Bool) -> NSColor {
    dark
      ? NSColor(srgbRed: 0xFA / 255, green: 0xFA / 255, blue: 0xFA / 255, alpha: 1)
      : NSColor(srgbRed: 0x16 / 255, green: 0x16 / 255, blue: 0x16 / 255, alpha: 1)
  }

  /// `--text-faint` from the graphite design tokens.
  private static let textFaint = NSColor(
    srgbRed: 0x80 / 255, green: 0x80 / 255, blue: 0x80 / 255, alpha: 1)

  /// 13 pt at weight 440, as Hex's UI type, on the system font's weight axis.
  private static let font: NSFont = {
    let wght = NSNumber(value: 0x7767_6874)
    let descriptor = NSFont.systemFont(ofSize: 13).fontDescriptor.addingAttributes([
      .variation: [wght: 440]
    ])
    return NSFont(descriptor: descriptor, size: 13) ?? .systemFont(ofSize: 13)
  }()
}
