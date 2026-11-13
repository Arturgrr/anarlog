import CoreGraphics
import Foundation

// Where the dictation HUD sits on its screen, and the notch indicator's
// geometry, ported from Hex (MIT, © 2026 Christopher Langton):
// `src/rune_hud/hud_placement.rs` (the top and bottom offsets, notch
// detection, the ears) and the island's shape and glyphs in `src/rune_hud.rs`
// and `src/rune_hud.wgsl`. Pure geometry over one screen's metrics;
// `DictationHud` reads them from `NSScreen` and applies the result.

/// Where the dictation settings put the HUD.
enum HudPosition: String {
  case top
  case bottom
  case hidden
  case notch
}

/// One screen as `NSScreen` describes it, in AppKit coordinates (y up).
struct HudScreen: Equatable {
  var frame: CGRect
  var visibleFrame: CGRect
  /// `safeAreaInsets.top`: the notch's height, 0 on a flat screen.
  var safeTop: CGFloat
  /// The widths of `auxiliaryTopLeftArea` and `auxiliaryTopRightArea`, the
  /// menu bar either side of the notch; 0 where there is none.
  var auxLeft: CGFloat = 0
  var auxRight: CGFloat = 0
}

/// A notch: its middle in screen x, and its size.
struct HudNotch: Equatable {
  var midX: CGFloat
  var width: CGFloat
  var height: CGFloat
}

/// How the HUD looks where it is placed.
enum HudLook: Equatable {
  /// The scope's plate, above the Dock when `bottom`, else under the menu bar.
  case scope(bottom: Bool)
  /// The notch indicator: the notch widened by an ear on each side.
  case ears(HudNotch)

  /// The notch the ears grow out of, when this is the notch indicator.
  var notch: HudNotch? {
    if case .ears(let notch) = self {
      return notch
    }
    return nil
  }
}

/// Where the panel goes and how its content sits in it.
struct HudPlaced: Equatable {
  /// The panel's bottom-left corner, screen coordinates.
  var origin: CGPoint
  var look: HudLook
  /// Whether the panel covers the menu bar and needs a level above it.
  var overMenuBar: Bool
  /// The live text plate's bottom edge in the panel (y up).
  var liveTextY: CGFloat
}

enum HudPlacement {
  /// The plate's gap under the menu bar: as close as it sits and still reads
  /// as its own thing.
  static let topOffset: CGFloat = 6
  /// The plate's gap above the Dock or the screen's bottom edge.
  static let bottomOffset: CGFloat = 24
  /// How far the notch indicator widens the notch on each side: room for one
  /// glyph beside the camera.
  static let earWidth: CGFloat = 34
  static let liveTextGap: CGFloat = 6
  static let liveTextHeight: CGFloat = 32

  /// The screen's notch, or nil on a flat screen.
  static func notch(of screen: HudScreen) -> HudNotch? {
    let width = screen.frame.width - screen.auxLeft - screen.auxRight
    guard screen.safeTop > 0, screen.auxLeft > 0, screen.auxRight > 0, width > 0 else {
      return nil
    }
    return HudNotch(
      midX: screen.frame.minX + screen.auxLeft + width / 2, width: width, height: screen.safeTop)
  }

  /// Places a `panel`-sized panel whose scope plate, `plateHeight` tall, sits
  /// in its middle. Notch hangs the panel from the screen's top edge around
  /// the notch, or is Top on a screen without one; Hidden never gets here
  /// and reads as Top.
  static func place(
    _ position: HudPosition, on screen: HudScreen, panel: CGSize, plateHeight: CGFloat
  ) -> HudPlaced {
    if position == .notch, let notch = notch(of: screen) {
      return HudPlaced(
        origin: CGPoint(x: notch.midX - panel.width / 2, y: screen.frame.maxY - panel.height),
        look: .ears(notch),
        overMenuBar: true,
        liveTextY: panel.height - notch.height - liveTextGap - liveTextHeight)
    }
    let bottom = position == .bottom
    let half = plateHeight / 2
    let plateMiddle: CGFloat
    if bottom {
      plateMiddle = screen.visibleFrame.minY + bottomOffset + half
    } else {
      // Under the notch where a full-screen space hides the menu bar and
      // `visibleFrame` reaches the top of a notched screen.
      let plateTop = min(screen.visibleFrame.maxY, screen.frame.maxY - screen.safeTop) - topOffset
      plateMiddle = plateTop - half
    }
    // The live text faces the screen's middle: under the plate at the top,
    // over it at the bottom.
    let liveTextY =
      bottom
      ? panel.height / 2 + half + liveTextGap
      : panel.height / 2 - half - liveTextGap - liveTextHeight
    return HudPlaced(
      origin: CGPoint(x: screen.frame.midX - panel.width / 2, y: plateMiddle - panel.height / 2),
      look: .scope(bottom: bottom),
      overMenuBar: false,
      liveTextY: liveTextY)
  }
}

/// The notch indicator's shapes: the island hanging from the screen's top
/// edge, its glyphs' places, the level bars and the spinner.
enum HudEars {
  static let notchRadius: CGFloat = 8
  static let earsRadius: CGFloat = 14
  /// The level bars: 2.2 pt capsules 4 pt apart.
  static let barWidth: CGFloat = 2.2
  static let barPitch: CGFloat = 4
  static let barRest: CGFloat = 2.4
  static let barProfile: [CGFloat] = [0.5, 0.8, 1.0, 0.75, 0.55]
  private static let barRate: [CGFloat] = [1.7, 2.3, 1.9, 2.6, 2.1]
  private static let barPhase: [CGFloat] = [0, 1.3, 2.1, 0.7, 1.7]
  static let spokes = 12

  /// The island's width and lower corners' radius at `open`, 0 for the
  /// notch itself and 1 for open; never narrower than the notch nor wider
  /// than `maxWidth`.
  static func island(notch: HudNotch, open: CGFloat, maxWidth: CGFloat) -> (
    width: CGFloat, radius: CGFloat
  ) {
    let grow = max(open, 0)
    let wide = max(min(notch.width + 2 * HudPlacement.earWidth, maxWidth), notch.width)
    let radius = notchRadius + (earsRadius - notchRadius) * min(grow, 1)
    return (notch.width + (wide - notch.width) * grow, min(radius, notch.height / 2))
  }

  /// How far each glyph's middle sits from the notch's middle: in the
  /// middle of its ear, a point towards the camera.
  static func glyphInset(notch: HudNotch) -> CGFloat {
    notch.width / 2 + HudPlacement.earWidth / 2 - 1
  }

  /// How open the ears are for their glyphs, 0 to 1: glyphs show once an
  /// ear has some room.
  static func room(notch: HudNotch, width: CGFloat) -> CGFloat {
    smoothstep(0.35, 1, (width - notch.width) / 2 / HudPlacement.earWidth)
  }

  /// The island in a layer whose top edge is `top` (y up): a box `width` by
  /// `height` hanging from the top around `midX`, its lower corners rounded
  /// by `radius`, with concave fillets where it meets the top edge.
  static func islandPath(
    midX: CGFloat, top: CGFloat, width: CGFloat, height: CGFloat, radius: CGFloat
  ) -> CGPath {
    let half = max(width / 2, 0)
    let height = max(height, 0)
    let radius = max(min(radius, height / 2, half), 0)
    let fillet = max(min(height * 0.25, 6, height - radius), 0)
    let left = midX - half
    let right = midX + half
    let bottom = top - height
    let path = CGMutablePath()
    path.move(to: CGPoint(x: left - fillet, y: top))
    path.addArc(
      tangent1End: CGPoint(x: left, y: top), tangent2End: CGPoint(x: left, y: bottom),
      radius: fillet)
    path.addArc(
      tangent1End: CGPoint(x: left, y: bottom), tangent2End: CGPoint(x: right, y: bottom),
      radius: radius)
    path.addArc(
      tangent1End: CGPoint(x: right, y: bottom), tangent2End: CGPoint(x: right, y: top),
      radius: radius)
    path.addArc(
      tangent1End: CGPoint(x: right, y: top), tangent2End: CGPoint(x: right + fillet, y: top),
      radius: fillet)
    path.addLine(to: CGPoint(x: right + fillet, y: top))
    path.closeSubpath()
    return path
  }

  /// Bar `index`'s height: at rest unless recording, where it follows the
  /// voice's 0–1 `level` (read as its square root, so ordinary speech moves
  /// it) and wobbles, except with Reduce Motion.
  static func barHeight(
    index: Int, level: CGFloat, clock: CGFloat, recording: Bool, reduceMotion: Bool
  ) -> CGFloat {
    guard recording, barProfile.indices.contains(index) else { return barRest }
    let turn = 2 * CGFloat.pi * clock * barRate[index] * 0.5 + barPhase[index]
    let wobble: CGFloat = reduceMotion ? 1 : 0.6 + 0.4 * sin(turn)
    return barRest + 10 * min(max(level, 0), 1).squareRoot() * barProfile[index] * wobble
  }

  /// Spoke `index`'s (clockwise from the top) opacity: the macOS spinner's
  /// fading tail behind a head that turns once a second; still with Reduce
  /// Motion.
  static func spokeShade(index: Int, clock: CGFloat, reduceMotion: Bool) -> CGFloat {
    let count = CGFloat(spokes)
    let head = reduceMotion ? 0 : (clock * count).rounded(.down)
    let gap = head - CGFloat(index)
    let behind = gap - count * (gap / count).rounded(.down)
    return 0.2 + 0.8 * CGFloat(pow(Double(1 - behind / count), 1.5))
  }

  /// The check mark's pop, as a scale: in over 0.16 s with a little
  /// overshoot; whole at once with Reduce Motion.
  static func pop(clock: CGFloat, reduceMotion: Bool) -> CGFloat {
    guard !reduceMotion else { return 1 }
    let t = min(max(clock / 0.16, 0), 1)
    return max(smoothstep(0, 1, t) * (1 + 0.2 * sin(t * .pi)), 0.05)
  }

  private static func smoothstep(_ a: CGFloat, _ b: CGFloat, _ x: CGFloat) -> CGFloat {
    let t = min(max((x - a) / (b - a), 0), 1)
    return t * t * (3 - 2 * t)
  }
}
