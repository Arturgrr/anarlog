// The selector as plain state: area or window mode, Space toggling them, a
// drag making an area, a click picking the front-most window under it,
// Return or a click without a drag taking the whole display in a
// recording's selector, Escape cancelling. What it shows on each display
// follows Hex (MIT, © 2026 Christopher Langton),
// `src/rune_ui/capture_capsule/picker.rs` (`window_at`, `Scene::at`).
// Points are each display's own, from its top-left corner; windows and
// displays come in Core Graphics' global top-left points.

import CoreGraphics
import Foundation

enum CaptureSelectMode: Equatable {
  case area
  case window
}

/// A window the selector can pick, from the window list.
struct CaptureWindow: Equatable {
  var id: UInt32
  var pid: Int32
  /// Global top-left points.
  var frame: CGRect
  var owner: String?
  var title: String?
}

/// A display as the window list measures it: `CGDisplayBounds`.
struct CaptureDisplay: Equatable {
  var id: UInt32
  var bounds: CGRect
}

enum CaptureSelection: Equatable {
  /// A dragged area, in the display's points.
  case area(display: UInt32, rect: CGRect)
  /// A window, its frame cut to the display.
  case window(display: UInt32, rect: CGRect, window: CaptureWindow)
  /// The whole display.
  case display(UInt32)
  case cancelled
}

/// What one display's selector view draws.
struct CaptureScene: Equatable {
  enum Kind: Equatable {
    /// Dim everywhere, the hint showing.
    case nothing
    case area
    case window
    /// A click takes the whole display.
    case display
  }

  var kind: Kind
  /// The target in the display's points; `.zero` for none.
  var target: CGRect
  /// The badge's text, nil for no badge.
  var badge: String?
  /// The pointer, which an area's badge sits beside.
  var pointer: CGPoint?

  static let empty = CaptureScene(kind: .nothing, target: .zero, badge: nil, pointer: nil)
}

struct CaptureSelector {
  struct Spot: Equatable {
    var display: UInt32
    var point: CGPoint
  }

  let purpose: CapturePurpose
  let displays: [CaptureDisplay]
  /// Front to back.
  let windows: [CaptureWindow]
  private(set) var mode: CaptureSelectMode
  private(set) var pointer: Spot?
  /// Where the button went down, and where the drag is now (on the same
  /// display's points).
  private(set) var press: Spot?
  private(set) var dragTo: CGPoint?

  init(
    purpose: CapturePurpose, mode: CaptureSelectMode, displays: [CaptureDisplay],
    windows: [CaptureWindow]
  ) {
    self.purpose = purpose
    self.mode = mode
    self.displays = displays
    self.windows = windows
  }

  /// Space: area ↔ window; a drag under way is dropped.
  mutating func toggleMode() {
    mode = mode == .area ? .window : .area
    press = nil
    dragTo = nil
  }

  mutating func moved(_ point: CGPoint, on display: UInt32) {
    pointer = Spot(display: display, point: point)
  }

  mutating func down(_ point: CGPoint, on display: UInt32) {
    pointer = Spot(display: display, point: point)
    press = Spot(display: display, point: point)
    dragTo = nil
  }

  /// The drag goes on in the display where it began, even past its edge.
  mutating func dragged(_ point: CGPoint) {
    guard let press else { return }
    dragTo = point
    if let size = displaySize(press.display) {
      pointer = Spot(display: press.display, point: CaptureGeometry.clamp(point, size))
    }
  }

  /// The button came up at `point` (the pressed display's points): the
  /// selection, or nil to go on selecting.
  mutating func up(_ point: CGPoint) -> CaptureSelection? {
    guard let press, let size = displaySize(press.display) else { return nil }
    self.press = nil
    dragTo = nil
    switch mode {
    case .window:
      let at = CaptureGeometry.clamp(point, size)
      if let picked = hit(at, on: press.display) {
        return .window(display: press.display, rect: picked.rect, window: picked.window)
      }
      return .display(press.display)
    case .area:
      if let rect = CaptureGeometry.areaRect(press.point, point, size: size) {
        return .area(display: press.display, rect: rect)
      }
      return purpose == .recording ? .display(press.display) : nil
    }
  }

  /// Return: a recording's selector takes the display under the pointer.
  func returnKey() -> CaptureSelection? {
    guard purpose == .recording else { return nil }
    guard let display = pointer?.display ?? displays.first?.id else { return nil }
    return .display(display)
  }

  /// The front-most window holding `point` on `display`, with its frame
  /// cut to the display.
  func hit(_ point: CGPoint, on display: UInt32) -> (window: CaptureWindow, rect: CGRect)? {
    guard let bounds = displays.first(where: { $0.id == display })?.bounds else { return nil }
    let global = CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y)
    guard
      let found = windows.first(where: { candidate in
        global.x >= candidate.frame.minX && global.x <= candidate.frame.maxX
          && global.y >= candidate.frame.minY && global.y <= candidate.frame.maxY
      })
    else {
      return nil
    }
    let local = found.frame.offsetBy(dx: -bounds.minX, dy: -bounds.minY)
    return (found, CaptureGeometry.clip(local, size: bounds.size))
  }

  /// What `display`'s view shows now.
  func scene(on display: UInt32) -> CaptureScene {
    guard let size = displaySize(display) else { return .empty }
    let here = pointer?.display == display ? pointer?.point : nil
    switch mode {
    case .area:
      guard let press, press.display == display, let dragTo else {
        return CaptureScene(kind: .nothing, target: .zero, badge: nil, pointer: here)
      }
      let rect = CaptureGeometry.dragRect(press.point, dragTo, size: size)
      return CaptureScene(
        kind: .area, target: rect, badge: CaptureGeometry.sizeLabel(rect.size),
        pointer: CaptureGeometry.clamp(dragTo, size))
    case .window:
      guard let here else {
        return CaptureScene(kind: .nothing, target: .zero, badge: nil, pointer: nil)
      }
      guard let hovered = hit(here, on: display) else {
        return CaptureScene(
          kind: .display, target: CGRect(origin: .zero, size: size), badge: nil, pointer: here)
      }
      let label = CaptureGeometry.windowLabel(
        app: hovered.window.owner, title: hovered.window.title, size: hovered.window.frame.size)
      return CaptureScene(kind: .window, target: hovered.rect, badge: label, pointer: here)
    }
  }

  private func displaySize(_ display: UInt32) -> CGSize? {
    displays.first { $0.id == display }?.bounds.size
  }
}
