// Capture's arithmetic as pure functions: the selector's rectangles and
// badge, a frozen display's crop, the recording's and the thumbnail's
// pixel sizes, the outline around a region, the cards' stack and the GIF's
// frames. The selector's rectangles and badge follow Hex (MIT, © 2026
// Christopher Langton), `src/rune_ui/capture_capsule/picker.rs`
// (`drag_rect`, `area_rect`, `clip_rect`, `place_badge`); the cards' sizes
// and stack its `src/rune_ui/screenshot_thumbnail.rs` (`card_size`,
// `slots`).

import CoreGraphics
import Foundation

enum CaptureLook {
  /// The dim outside the target.
  static let dim: CGFloat = 0.32
  /// A window's tint, its outline and corner.
  static let windowTint: CGFloat = 0.13
  static let windowRing: CGFloat = 2
  static let windowRadius: CGFloat = 10
  /// The area's white ring, and the dark hairline just outside it so the
  /// area reads over white as well as dark.
  static let areaRing: CGFloat = 1
  static let areaEdge: CGFloat = 0.5
  static let badgeHeight: CGFloat = 22
  static let badgePadding: CGFloat = 8
  /// Clear of the crosshair's arms.
  static let pointerGap: CGFloat = 14
  static let badgeMargin: CGFloat = 8
  static let badgeMaxWidth: CGFloat = 480
  /// The recording's outline, just outside the region.
  static let outline: CGFloat = 2
}

enum CaptureGeometry {
  /// The smallest area the selector takes, points a side; a smaller drag is
  /// a click.
  static let minAreaSide: CGFloat = 36
  /// H.264's largest frame (level 5.2): at most 4096 pixels a side and
  /// 4096 × 2304 pixels in all, so a 16:9 5K display records at 4096 × 2304
  /// and a 16:10 one a little smaller.
  static let videoLongEdge = 4096
  static let videoMaxArea = 4096 * 2304

  static func clamp(_ point: CGPoint, _ size: CGSize) -> CGPoint {
    CGPoint(x: min(max(point.x, 0), size.width), y: min(max(point.y, 0), size.height))
  }

  /// The rectangle between a drag's ends, kept on the display.
  static func dragRect(_ a: CGPoint, _ b: CGPoint, size: CGSize) -> CGRect {
    let (a, b) = (clamp(a, size), clamp(b, size))
    return CGRect(
      x: min(a.x, b.x), y: min(a.y, b.y), width: abs(a.x - b.x), height: abs(a.y - b.y))
  }

  /// A dragged area, if it is big enough to take.
  static func areaRect(_ a: CGPoint, _ b: CGPoint, size: CGSize) -> CGRect? {
    let rect = dragRect(a, b, size: size)
    guard rect.width >= minAreaSide, rect.height >= minAreaSide else { return nil }
    return rect
  }

  /// `rect` cut to a display of `size` (top-left points); empty when off it.
  static func clip(_ rect: CGRect, size: CGSize) -> CGRect {
    let x0 = min(max(rect.minX, 0), size.width)
    let y0 = min(max(rect.minY, 0), size.height)
    let x1 = min(max(rect.maxX, 0), size.width)
    let y1 = min(max(rect.maxY, 0), size.height)
    return CGRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0)
  }

  /// "W × H" in points.
  static func sizeLabel(_ size: CGSize) -> String {
    "\(Int(size.width.rounded())) × \(Int(size.height.rounded()))"
  }

  /// "App — Title", the app alone when the title adds nothing, else the
  /// window's size.
  static func windowLabel(app: String?, title: String?, size: CGSize) -> String {
    if let app, !app.isEmpty {
      if let title, !title.isEmpty, title != app { return "\(app) — \(title)" }
      return app
    }
    if let title, !title.isEmpty { return title }
    return sizeLabel(size)
  }

  /// Where a badge of `badge` size sits by `target` on a display of `size`.
  /// With a pointer (an area being dragged) it sits beside the pointer on
  /// the outside of the area, flipping at the display's edges; without
  /// one, centred on the target. Always on the display.
  static func placeBadge(
    target: CGRect, badge: CGSize, display size: CGSize, pointer: CGPoint?
  ) -> CGPoint {
    let (bw, bh) = (badge.width, badge.height)
    let margin = CaptureLook.badgeMargin
    let x: CGFloat
    let y: CGFloat
    if let pointer {
      let px = min(max(pointer.x, target.minX), target.maxX)
      let py = min(max(pointer.y, target.minY), target.maxY)
      let gap = CaptureLook.pointerGap
      let (afterX, beforeX) = (px + gap, px - gap - bw)
      let (afterY, beforeY) = (py + gap, py - gap - bh)
      let fitsX = { (left: CGFloat) in left >= margin && left + bw <= size.width - margin }
      let fitsY = { (top: CGFloat) in top >= margin && top + bh <= size.height - margin }
      let (firstX, secondX) = px >= target.midX ? (afterX, beforeX) : (beforeX, afterX)
      let (firstY, secondY) = py >= target.midY ? (afterY, beforeY) : (beforeY, afterY)
      x = fitsX(firstX) ? firstX : secondX
      y = fitsY(firstY) ? firstY : secondY
    } else {
      x = target.minX + (target.width - bw) / 2
      y = target.minY + (target.height - bh) / 2
    }
    let maxX = max(size.width - margin - bw, margin)
    let maxY = max(size.height - margin - bh, margin)
    return CGPoint(x: min(max(x, margin), maxX), y: min(max(y, margin), maxY))
  }

  /// The pixels of a frozen display image under `region` (display points
  /// from its top-left corner): rounded outward to whole pixels, cut to the
  /// image. Nil when nothing is left.
  static func cropRect(
    _ region: CGRect, display size: CGSize, imageWidth: Int, imageHeight: Int
  ) -> CGRect? {
    guard size.width > 0, size.height > 0, imageWidth > 0, imageHeight > 0 else { return nil }
    let (width, height) = (CGFloat(imageWidth), CGFloat(imageHeight))
    let (sx, sy) = (width / size.width, height / size.height)
    // Float noise must not grow the crop by a whole pixel.
    let noise: CGFloat = 1e-6
    let x0 = min(max((region.minX * sx + noise).rounded(.down), 0), width)
    let y0 = min(max((region.minY * sy + noise).rounded(.down), 0), height)
    let x1 = min(max((region.maxX * sx - noise).rounded(.up), 0), width)
    let y1 = min(max((region.maxY * sy - noise).rounded(.up), 0), height)
    guard x1 > x0, y1 > y0 else { return nil }
    return CGRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0)
  }

  /// The movie's size for a region: its points × `scale`, never above the
  /// display's own pixels, `longEdge` a side nor `maxArea` in all, the
  /// aspect kept and both sides even. Nil for an empty region.
  static func recordingSize(
    _ region: CGSize, scale: CGFloat, nativeWidth: Int, nativeHeight: Int,
    longEdge: Int = CaptureGeometry.videoLongEdge, maxArea: Int = CaptureGeometry.videoMaxArea
  ) -> (width: Int, height: Int)? {
    let factor = scale.isFinite && scale > 0 ? Double(scale) : 1
    let width = min(Double(region.width) * factor, Double(max(nativeWidth, 2)))
    let height = min(Double(region.height) * factor, Double(max(nativeHeight, 2)))
    guard width.isFinite, height.isFinite, width > 0, height > 0 else { return nil }
    var fit = min(1, Double(longEdge) / max(width, height))
    var rule = FloatingPointRoundingRule.toNearestOrAwayFromZero
    // The pixel past the area's edge allows for float noise in an exact fit.
    if width * fit * height * fit > Double(maxArea) + 1 {
      fit = (Double(maxArea) / (width * height)).squareRoot()
      // Rounded down, so the area stays within the limit.
      rule = .down
    }
    func even(_ value: Double) -> Int {
      let pixels = (value * fit).rounded(rule)
      guard pixels < Double(Int32.max) else { return 2 }
      return max(Int(pixels) & ~1, 2)
    }
    return (even(width), even(height))
  }

  /// `rect` in `screen`'s top-left points as AppKit's global rectangle.
  static func global(_ rect: CGRect, on screen: AnnotateScreen) -> CGRect {
    CGRect(
      x: screen.frame.minX + rect.minX, y: screen.frame.maxY - rect.maxY, width: rect.width,
      height: rect.height)
  }

  /// The outline panel's frame: the region grown by the ring on every
  /// side, kept on the display (a whole display's ring sits just inside).
  static func outlineFrame(_ region: CGRect, on screen: AnnotateScreen) -> CGRect {
    let ring = CaptureLook.outline
    return global(region, on: screen).insetBy(dx: -ring, dy: -ring).intersection(screen.frame)
  }

  /// A picture's size with its long edge at most `longEdge`; never larger
  /// than it is.
  static func fitted(width: Int, height: Int, longEdge: Int) -> (width: Int, height: Int) {
    let (w, h) = (max(width, 1), max(height, 1))
    let long = max(w, h)
    guard long > longEdge, longEdge > 0 else { return (w, h) }
    let scale = Double(longEdge) / Double(long)
    return (
      max(Int((Double(w) * scale).rounded()), 1), max(Int((Double(h) * scale).rounded()), 1)
    )
  }
}

// MARK: Cards

enum CaptureCardLayout {
  static let maxSize = CGSize(width: 240, height: 168)
  static let minSize = CGSize(width: 48, height: 32)
  /// From the display's edges to the cards', and between cards.
  static let inset: CGFloat = 16
  static let gap: CGFloat = 12
  static let radius: CGFloat = 14
  /// Room around a card for its shadow.
  static let shadow: CGFloat = 12
  static let perDisplay = 4
  static let button: CGFloat = 30
  static let buttonGap: CGFloat = 8
  static let closeButton: CGFloat = 22
  static let closeInset: CGFloat = 6

  /// A card's size: its thumbnail fitted into `maxSize`.
  static func cardSize(width: Int, height: Int) -> CGSize {
    let (w, h) = (CGFloat(max(width, 1)), CGFloat(max(height, 1)))
    let fit = min(maxSize.width / w, maxSize.height / h)
    return CGSize(
      width: max((w * fit).rounded(), minSize.width),
      height: max((h * fit).rounded(), minSize.height))
  }

  /// Each card's rectangle in `area` (AppKit points, y up), oldest first:
  /// the newest in the bottom-right corner, each older one above the one
  /// after it.
  static func slots(_ sizes: [CGSize], in area: CGRect) -> [CGRect] {
    var bottom = area.minY + inset
    var placed: [CGRect] = []
    for size in sizes.reversed() {
      placed.append(
        CGRect(
          x: area.maxX - inset - size.width, y: bottom, width: size.width, height: size.height))
      bottom += size.height + gap
    }
    return placed.reversed()
  }

  /// The hover buttons on a card of `size` (its own points, y up): ✕ in the
  /// top-left corner, the others in a centred row when they fit.
  static func buttons(_ actions: [CaptureCardAction], size: CGSize) -> [(
    CaptureCardAction, CGRect
  )] {
    var placed: [(CaptureCardAction, CGRect)] = []
    let row = actions.filter { $0 != .close }
    let total = CGFloat(row.count) * button + CGFloat(max(row.count - 1, 0)) * buttonGap
    if !row.isEmpty, total <= size.width - 8, size.height >= 64 {
      var x = ((size.width - total) / 2).rounded()
      let y = ((size.height - button) / 2).rounded()
      for action in row {
        placed.append((action, CGRect(x: x, y: y, width: button, height: button)))
        x += button + buttonGap
      }
    }
    if actions.contains(.close) {
      let y = size.height - closeInset - closeButton
      let rect = CGRect(x: closeInset, y: y, width: closeButton, height: closeButton)
      placed.append((CaptureCardAction.close, rect))
    }
    return placed
  }
}

// MARK: GIF

/// Which frames of a movie make its GIF, and how long each shows.
struct CaptureGifPlan: Equatable {
  /// GIF delays count in hundredths of a second; 2 is the shortest every
  /// viewer honours.
  static let minDelay = 0.02
  private static let minHundredths = 2.0
  static let maxFps = 50.0
  /// ImageIO keeps every frame until the file is finished: the frames'
  /// pixels together stay under this, but there are always at least
  /// `minFrames`.
  static let maxPixels = 150_000_000
  static let minFrames = 10

  var fps: Double
  /// Seconds into the movie, one per frame.
  var times: [Double]
  /// Seconds each frame shows, summing to the movie's length (to the
  /// hundredth), each at least `minDelay`.
  var delays: [Double]
  var width: Int
  var height: Int

  var frames: Int { times.count }

  /// Frames at `fps`, lowered so there are at most `maxFrames` (and at
  /// most `maxPixels` of them in all); the width at most `maxWidth`, never
  /// scaled up. Nil for a movie with no length or no picture.
  static func make(
    duration: Double, fps requested: Double, maxFrames: Int, width: Int, height: Int,
    maxWidth: Int
  ) -> CaptureGifPlan? {
    guard duration.isFinite, duration > 0, width > 0, height > 0 else { return nil }
    let size: (width: Int, height: Int)
    if width <= maxWidth || maxWidth <= 0 {
      size = (width, height)
    } else {
      let scaled = (Double(height) * Double(maxWidth) / Double(width)).rounded()
      size = (maxWidth, max(Int(scaled), 1))
    }
    let wanted = requested.isFinite && requested > 0 ? min(requested, maxFps) : 15
    let budget = max(maxPixels / max(size.width * size.height, 1), minFrames)
    let limit = min(max(maxFrames, 1), budget)
    let needed = max(Int((duration * wanted - 1e-9).rounded(.up)), 1)
    let (fps, count) = needed <= limit ? (wanted, needed) : (Double(limit) / duration, limit)
    let times = (0..<count).map { Double($0) / fps }
    // Delays from the times rounded to hundredths, so rounding never adds
    // up to drift.
    let ends = times.map { ($0 * 100).rounded() } + [(duration * 100).rounded()]
    let delays = (0..<count).map { index in
      max(ends[index + 1] - ends[index], minHundredths) / 100
    }
    return CaptureGifPlan(
      fps: fps, times: times, delays: delays, width: size.width, height: size.height)
  }
}
