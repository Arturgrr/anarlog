import AppKit
import QuartzCore

// The notch indicator, ported from Hex's Labs notch indicator (MIT, © 2026
// Christopher Langton; `src/rune_hud.rs` and `src/rune_hud.wgsl`): the notch
// widened sideways at its own height, Dynamic Island style, with a glyph in
// each ear. Leading: an orange microphone while recording, a spinner while
// working, a green check mark when done, a red exclamation mark on failure.
// Trailing: five level bars, orange with the voice, at rest while working.
// Drawn with Core Animation alone, apart from the scope's Metal shader, so
// it shows whether or not the shader built.

/// Apple's dark-appearance system colours: the island is black in either
/// appearance, as the notch is.
private enum HudEarsColor {
  static let orange = CGColor(srgbRed: 1, green: 0.624, blue: 0.039, alpha: 1)
  static let green = CGColor(srgbRed: 0.188, green: 0.820, blue: 0.345, alpha: 1)
  static let red = CGColor(srgbRed: 1, green: 0.271, blue: 0.227, alpha: 1)
  static let label = CGColor(srgbRed: 0.92, green: 0.92, blue: 0.94, alpha: 1)
  static let island = CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 1)
}

/// The island and its glyphs, in a view as wide as the panel and as tall as
/// the notch, at the panel's top. Main thread only.
final class HudEarsView: NSView {
  private static let glyphSize: CGFloat = 18
  private static let spokeInner: CGFloat = 2.7
  private static let spokeOuter: CGFloat = 6.1

  private let island = CAShapeLayer()
  private let leading = CALayer()
  private let mic = HudEarsView.glyph("mic.fill", color: HudEarsColor.orange)
  private let check = HudEarsView.glyph("checkmark", color: HudEarsColor.green)
  private let failure = HudEarsView.glyph(
    "exclamationmark.circle.fill", color: HudEarsColor.red)
  private let spinner = CALayer()
  private var spokes: [CAShapeLayer] = []
  private let trailing = CALayer()
  private var bars: [CALayer] = []
  private var symbolScale: CGFloat = 0

  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    guard let root = layer else { return }
    root.masksToBounds = false
    island.fillColor = HudEarsColor.island
    island.strokeColor = nil
    root.addSublayer(island)
    let size = Self.glyphSize
    for container in [leading, trailing] {
      container.bounds = CGRect(x: 0, y: 0, width: size, height: size)
      root.addSublayer(container)
    }
    for glyph in [mic, check, failure, spinner] {
      glyph.frame = leading.bounds
      leading.addSublayer(glyph)
    }
    for index in 0..<HudEars.spokes {
      let spoke = CAShapeLayer()
      let angle = 2 * CGFloat.pi * CGFloat(index) / CGFloat(HudEars.spokes)
      let direction = CGPoint(x: sin(angle), y: cos(angle))
      let path = CGMutablePath()
      path.move(
        to: CGPoint(
          x: size / 2 + direction.x * Self.spokeInner, y: size / 2 + direction.y * Self.spokeInner))
      path.addLine(
        to: CGPoint(
          x: size / 2 + direction.x * Self.spokeOuter, y: size / 2 + direction.y * Self.spokeOuter))
      spoke.path = path
      spoke.strokeColor = HudEarsColor.label
      spoke.fillColor = nil
      spoke.lineWidth = 1.5
      spoke.lineCap = .round
      spoke.frame = spinner.bounds
      spinner.addSublayer(spoke)
      spokes.append(spoke)
    }
    for _ in HudEars.barProfile {
      let bar = CALayer()
      bar.cornerRadius = HudEars.barWidth / 2
      trailing.addSublayer(bar)
      bars.append(bar)
    }
    reset()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override var isOpaque: Bool { false }

  /// Nothing drawn: the island and its glyphs clear, before the panel hides
  /// and before it shows again.
  func reset() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    island.path = nil
    island.opacity = 0
    leading.opacity = 0
    trailing.opacity = 0
    CATransaction.commit()
  }

  /// Lays out one frame of the ears for `pose` around `notch`, whose middle
  /// is the view's middle.
  func update(pose: HudEarsPose, notch: HudNotch, scale: CGFloat) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }
    if scale != symbolScale {
      symbolScale = scale
      for glyph in [mic, check, failure] {
        Self.fitSymbol(glyph, scale: scale)
      }
      layer?.contentsScale = scale
      island.contentsScale = scale
    }
    let midX = bounds.midX
    let top = bounds.height
    let (width, radius) = HudEars.island(
      notch: notch, open: CGFloat(pose.open), maxWidth: bounds.width - 2)
    island.frame = bounds
    island.path = HudEars.islandPath(
      midX: midX, top: top, width: width, height: notch.height, radius: radius)
    let opacity = Float(min(max(pose.opacity, 0), 1))
    island.opacity = opacity

    let room = HudEars.room(notch: notch, width: width)
    let glyphScale = 0.72 + 0.28 * room
    let middleY = top - notch.height / 2
    let inset = HudEars.glyphInset(notch: notch)
    let glyphOpacity = opacity * Float(room)
    leading.position = CGPoint(x: midX - inset, y: middleY)
    trailing.position = CGPoint(x: midX + inset, y: middleY)
    leading.transform = CATransform3DMakeScale(glyphScale, glyphScale, 1)
    trailing.transform = CATransform3DMakeScale(glyphScale, glyphScale, 1)
    leading.opacity = glyphOpacity
    trailing.opacity = glyphOpacity

    let clock = CGFloat(pose.clock)
    mic.isHidden = pose.stage != .recording
    spinner.isHidden = pose.stage != .processing
    check.isHidden = pose.stage != .done
    failure.isHidden = pose.stage != .failed
    if pose.stage == .processing {
      for (index, spoke) in spokes.enumerated() {
        spoke.opacity = Float(
          HudEars.spokeShade(index: index, clock: clock, reduceMotion: pose.reduceMotion))
      }
    }
    if pose.stage == .done {
      let pop = HudEars.pop(clock: clock, reduceMotion: pose.reduceMotion)
      check.transform = CATransform3DMakeScale(pop, pop, 1)
    }

    let recording = pose.stage == .recording
    let working = pose.stage == .processing
    let size = Self.glyphSize
    for (index, bar) in bars.enumerated() {
      let height = HudEars.barHeight(
        index: index, level: CGFloat(pose.level), clock: clock, recording: recording,
        reduceMotion: pose.reduceMotion)
      bar.frame = CGRect(
        x: size / 2 + CGFloat(index - 2) * HudEars.barPitch - HudEars.barWidth / 2,
        y: size / 2 - height / 2, width: HudEars.barWidth, height: height)
      bar.backgroundColor = recording ? HudEarsColor.orange : HudEarsColor.label
      bar.opacity = recording ? 1 : working ? Self.barLight(index: index, pose: pose) : 0
    }
  }

  /// Light running through the resting bars while the text is on its way;
  /// steady with Reduce Motion.
  private static func barLight(index: Int, pose: HudEarsPose) -> Float {
    guard !pose.reduceMotion else { return 0.6 }
    let wave = 0.5 + 0.5 * cos(2 * Float.pi * (pose.clock * 1.1 - Float(index) * 0.14))
    return 0.3 + 0.7 * wave * wave * wave
  }

  /// A glyph: `color` through an SF Symbol's shape. Draws nothing if the
  /// symbol is missing.
  private static func glyph(_ name: String, color: CGColor) -> CALayer {
    let glyph = CALayer()
    glyph.backgroundColor = color
    let mask = CALayer()
    mask.contentsGravity = .center
    mask.name = name
    glyph.mask = mask
    return glyph
  }

  private static func fitSymbol(_ glyph: CALayer, scale: CGFloat) {
    guard let mask = glyph.mask, let name = mask.name else { return }
    mask.frame = glyph.bounds
    let configuration = NSImage.SymbolConfiguration(pointSize: 13, weight: .semibold)
    guard
      let image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
        .withSymbolConfiguration(configuration)
    else {
      mask.contents = nil
      return
    }
    mask.contentsScale = image.recommendedLayerContentsScale(scale)
    mask.contents = image.layerContents(forContentsScale: mask.contentsScale)
  }
}
