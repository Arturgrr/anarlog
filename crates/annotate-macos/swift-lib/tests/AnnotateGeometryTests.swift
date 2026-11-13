import CoreGraphics
import XCTest

@testable import AnnotateMacOS

// The video size cases are those of Hex's `crates/capture-core/src/plan.rs`
// (MIT, © 2026 Christopher Langton).

final class AnnotateGeometryTests: XCTestCase {
  /// A 14-inch MacBook Pro: 1512 × 982 pt at 2x, a 32 pt notch, the menu
  /// bar as tall as the notch.
  private let notched = AnnotateScreen(
    id: 1, frame: CGRect(x: 0, y: 0, width: 1512, height: 982),
    visibleFrame: CGRect(x: 0, y: 70, width: 1512, height: 880), safeTop: 32, scale: 2)

  /// A 2560 × 1440 flat display left of the main one, its menu bar 24 pt.
  private let left = AnnotateScreen(
    id: 2, frame: CGRect(x: -2560, y: 0, width: 2560, height: 1440),
    visibleFrame: CGRect(x: -2560, y: 0, width: 2560, height: 1416), safeTop: 0, scale: 1)

  func testThePointerPicksItsDisplayAcrossANegativeOrigin() {
    let screens = [notched, left]
    XCTAssertEqual(AnnotateGeometry.screen(under: CGPoint(x: -1, y: 500), in: screens)?.id, 2)
    XCTAssertEqual(AnnotateGeometry.screen(under: CGPoint(x: 0, y: 500), in: screens)?.id, 1)
    // The top row of a display is on it; AppKit reports y = maxY there.
    XCTAssertEqual(AnnotateGeometry.screen(under: CGPoint(x: -10, y: 1440), in: screens)?.id, 2)
    // Off every display: the main one.
    XCTAssertEqual(AnnotateGeometry.screen(under: CGPoint(x: 9000, y: 0), in: screens)?.id, 1)
    XCTAssertNil(AnnotateGeometry.screen(under: .zero, in: []))
  }

  func testStrokesAreMeasuredFromTheDisplaysTopLeftCorner() {
    XCTAssertEqual(
      AnnotateGeometry.local(CGPoint(x: -2460, y: 1390), on: left), CGPoint(x: 100, y: 50))
    XCTAssertEqual(
      AnnotateGeometry.local(CGPoint(x: 756, y: 982), on: notched), CGPoint(x: 756, y: 0))
  }

  func testTheVideoKeepsItsAspectUnderTheLongEdgeAndIsNeverUpscaled() {
    let retina = AnnotateGeometry.pixelSize(
      points: CGSize(width: 1728, height: 1117), scale: 2, longEdge: 2560)
    XCTAssertEqual(retina?.width, 2560)
    XCTAssertEqual(retina?.height, 1654)
    let plain = AnnotateGeometry.pixelSize(
      points: CGSize(width: 1920, height: 1080), scale: 1, longEdge: 2560)
    XCTAssertEqual(plain?.width, 1920)
    XCTAssertEqual(plain?.height, 1080)
    let candidate = AnnotateGeometry.pixelSize(points: notched.frame.size, scale: 2, longEdge: 480)
    XCTAssertEqual(candidate?.width, 480)
    XCTAssertEqual(candidate?.height, 312)
    XCTAssertNil(AnnotateGeometry.pixelSize(points: .zero, scale: 2, longEdge: 2560))
  }

  func testTheCapsuleSitsUnderTheMenuBarOrTheNotch() {
    let size = AnnotateCapsuleLayout.size
    XCTAssertEqual(
      AnnotateCapsuleLayout.origin(on: left),
      CGPoint(x: -1280 - size.width / 2, y: 1416 - 8 - size.height))
    XCTAssertEqual(
      AnnotateCapsuleLayout.origin(on: notched),
      CGPoint(x: 756 - size.width / 2, y: 950 - 8 - size.height))
    // A full-screen space hides the menu bar; the capsule still clears the
    // notch.
    var fullScreen = notched
    fullScreen.visibleFrame = notched.frame
    XCTAssertEqual(AnnotateCapsuleLayout.origin(on: fullScreen).y, 982 - 32 - 8 - size.height)
  }

  func testEachCapsuleButtonAnswersOnlyInsideItself() {
    let recording = AnnotateCapsuleLayout.make(asking: false)
    for (target, rect) in recording.targets {
      XCTAssertEqual(recording.target(at: CGPoint(x: rect.midX, y: rect.midY)), target)
    }
    XCTAssertEqual(recording.targets.map { $0.0 }, [.pen, .stop, .discard])
    XCTAssertNil(recording.target(at: CGPoint(x: recording.dot.midX, y: recording.dot.midY)))
    XCTAssertNil(recording.target(at: CGPoint(x: recording.clock.midX, y: recording.clock.midY)))

    let asking = AnnotateCapsuleLayout.make(asking: true)
    XCTAssertEqual(asking.targets.map { $0.0 }, [.confirmDiscard, .keep])
    XCTAssertNil(asking.target(at: CGPoint(x: asking.question.midX, y: asking.question.midY)))
    // Every button fits in the capsule without overlapping another.
    for layout in [recording, asking] {
      let bounds = CGRect(origin: .zero, size: AnnotateCapsuleLayout.size)
      for (index, (_, rect)) in layout.targets.enumerated() {
        XCTAssertTrue(bounds.contains(rect))
        for (_, other) in layout.targets.dropFirst(index + 1) {
          XCTAssertFalse(rect.intersects(other))
        }
      }
    }
  }
}
