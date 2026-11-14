import CoreGraphics
import XCTest

@testable import AnnotateMacOS

// The badge and card cases follow Hex's `picker.rs` and
// `screenshot_thumbnail.rs` (MIT, © 2026 Christopher Langton).

final class CaptureGeometryTests: XCTestCase {
  private let display = CGSize(width: 1512, height: 982)

  func testADragIsNormalisedKeptOnTheDisplayAndTooSmallIsAClick() {
    XCTAssertEqual(
      CaptureGeometry.dragRect(CGPoint(x: 300, y: 200), CGPoint(x: 100, y: 50), size: display),
      CGRect(x: 100, y: 50, width: 200, height: 150))
    XCTAssertEqual(
      CaptureGeometry.dragRect(CGPoint(x: -40, y: 900), CGPoint(x: 60, y: 1200), size: display),
      CGRect(x: 0, y: 900, width: 60, height: 82))
    XCTAssertEqual(
      CaptureGeometry.areaRect(CGPoint(x: 10, y: 10), CGPoint(x: 46, y: 46), size: display),
      CGRect(x: 10, y: 10, width: 36, height: 36))
    XCTAssertNil(
      CaptureGeometry.areaRect(CGPoint(x: 10, y: 10), CGPoint(x: 45, y: 400), size: display))
  }

  func testAWindowIsCutToItsDisplay() {
    XCTAssertEqual(
      CaptureGeometry.clip(CGRect(x: -20, y: 900, width: 200, height: 200), size: display),
      CGRect(x: 0, y: 900, width: 180, height: 82))
    XCTAssertEqual(
      CaptureGeometry.clip(CGRect(x: 2000, y: 0, width: 10, height: 10), size: display).width, 0)
  }

  func testTheBadgeSitsOutsideTheAreaByThePointerAndStaysOnTheDisplay() {
    let screen = CGSize(width: 1000, height: 800)
    let badge = CGSize(width: 80, height: 22)
    // Dragged down-right: beside the pointer, below and right of it.
    XCTAssertEqual(
      CaptureGeometry.placeBadge(
        target: CGRect(x: 100, y: 100, width: 200, height: 150), badge: badge, display: screen,
        pointer: CGPoint(x: 300, y: 250)),
      CGPoint(x: 314, y: 264))
    // Dragged up-left from the display's corner: it flips back inside.
    XCTAssertEqual(
      CaptureGeometry.placeBadge(
        target: CGRect(x: 500, y: 500, width: 490, height: 290), badge: badge, display: screen,
        pointer: CGPoint(x: 990, y: 790)),
      CGPoint(x: 896, y: 754))
    // Dragged up-left: before the pointer on both axes.
    XCTAssertEqual(
      CaptureGeometry.placeBadge(
        target: CGRect(x: 200, y: 200, width: 300, height: 300), badge: badge, display: screen,
        pointer: CGPoint(x: 200, y: 200)),
      CGPoint(x: 106, y: 164))
    // A window's badge is centred on it.
    XCTAssertEqual(
      CaptureGeometry.placeBadge(
        target: CGRect(x: 0, y: 0, width: 1000, height: 800), badge: badge, display: screen,
        pointer: nil),
      CGPoint(x: 460, y: 389))
  }

  func testLabelsNameTheWindowOrItsSize() {
    XCTAssertEqual(CaptureGeometry.sizeLabel(CGSize(width: 200.4, height: 99.5)), "200 × 100")
    XCTAssertEqual(
      CaptureGeometry.windowLabel(app: "Safari", title: "Apple", size: .zero), "Safari — Apple")
    XCTAssertEqual(CaptureGeometry.windowLabel(app: "Notes", title: "Notes", size: .zero), "Notes")
    XCTAssertEqual(
      CaptureGeometry.windowLabel(app: nil, title: nil, size: CGSize(width: 640, height: 480)),
      "640 × 480")
  }

  func testTheCropRoundsOutwardToWholePixelsAndStaysOnTheImage() {
    XCTAssertEqual(
      CaptureGeometry.cropRect(
        CGRect(x: 10.25, y: 20, width: 100.5, height: 50), display: display, imageWidth: 3024,
        imageHeight: 1964),
      CGRect(x: 20, y: 40, width: 202, height: 100))
    XCTAssertEqual(
      CaptureGeometry.cropRect(
        CGRect(x: 1500, y: 900, width: 100, height: 100), display: display, imageWidth: 3024,
        imageHeight: 1964),
      CGRect(x: 3000, y: 1800, width: 24, height: 164))
    // 0.1 + 0.2 is a hair over 0.3: float noise never adds a pixel.
    XCTAssertEqual(
      CaptureGeometry.cropRect(
        CGRect(x: 0.1, y: 0.1, width: 0.2, height: 0.2), display: CGSize(width: 100, height: 100),
        imageWidth: 1000, imageHeight: 1000),
      CGRect(x: 1, y: 1, width: 2, height: 2))
    XCTAssertNil(
      CaptureGeometry.cropRect(
        CGRect(x: 2000, y: 0, width: 10, height: 10), display: display, imageWidth: 3024,
        imageHeight: 1964))
  }

  func testTheMovieIsTheRegionsPixelsWithEvenSidesAndNeverAboveTheDisplay() {
    let retina = CaptureGeometry.recordingSize(
      CGSize(width: 400.5, height: 300), scale: 2, nativeWidth: 3024, nativeHeight: 1964)
    XCTAssertEqual(retina?.width, 800)
    XCTAssertEqual(retina?.height, 600)
    let odd = CaptureGeometry.recordingSize(
      CGSize(width: 100.7, height: 50.3), scale: 2, nativeWidth: 3024, nativeHeight: 1964)
    XCTAssertEqual(odd?.width, 200)
    XCTAssertEqual(odd?.height, 100)
    let whole = CaptureGeometry.recordingSize(
      CGSize(width: 1512, height: 982), scale: 2, nativeWidth: 3024, nativeHeight: 1964)
    XCTAssertEqual(whole?.width, 3024)
    XCTAssertEqual(whole?.height, 1964)
    let fiveK = CaptureGeometry.recordingSize(
      CGSize(width: 2560, height: 1440), scale: 2, nativeWidth: 5120, nativeHeight: 2880)
    XCTAssertEqual(fiveK?.width, 4096)
    XCTAssertEqual(fiveK?.height, 2304)
    let past = CaptureGeometry.recordingSize(
      CGSize(width: 2000, height: 100), scale: 2, nativeWidth: 3024, nativeHeight: 1964)
    XCTAssertEqual(past?.width, 3024)
    XCTAssertNil(
      CaptureGeometry.recordingSize(.zero, scale: 2, nativeWidth: 3024, nativeHeight: 1964))
  }

  func testTheOutlineRingsTheRegionFromOutside() {
    let screen = AnnotateScreen(
      id: 1, frame: CGRect(x: 0, y: 0, width: 1512, height: 982),
      visibleFrame: CGRect(x: 0, y: 70, width: 1512, height: 880), safeTop: 32, scale: 2)
    XCTAssertEqual(
      CaptureGeometry.outlineFrame(CGRect(x: 100, y: 50, width: 400, height: 300), on: screen),
      CGRect(x: 98, y: 630, width: 404, height: 304))
    XCTAssertEqual(
      CaptureGeometry.outlineFrame(CGRect(origin: .zero, size: display), on: screen),
      screen.frame)
    let left = AnnotateScreen(
      id: 2, frame: CGRect(x: -2560, y: 0, width: 2560, height: 1440),
      visibleFrame: CGRect(x: -2560, y: 0, width: 2560, height: 1416), safeTop: 0, scale: 1)
    XCTAssertEqual(
      CaptureGeometry.global(CGRect(x: 10, y: 20, width: 30, height: 40), on: left),
      CGRect(x: -2550, y: 1380, width: 30, height: 40))
  }

  func testThumbnailsShrinkToTheLongEdgeAndNeverGrow() {
    let shot = CaptureGeometry.fitted(width: 3024, height: 1964, longEdge: 480)
    XCTAssertEqual(shot.width, 480)
    XCTAssertEqual(shot.height, 312)
    let small = CaptureGeometry.fitted(width: 300, height: 200, longEdge: 480)
    XCTAssertEqual(small.width, 300)
    XCTAssertEqual(small.height, 200)
  }

  func testCardsFitTheirThumbnailAndStackNewestInTheCorner() {
    XCTAssertEqual(
      CaptureCardLayout.cardSize(width: 480, height: 300), CGSize(width: 240, height: 150))
    XCTAssertEqual(
      CaptureCardLayout.cardSize(width: 300, height: 480), CGSize(width: 105, height: 168))
    XCTAssertEqual(
      CaptureCardLayout.cardSize(width: 1000, height: 10), CGSize(width: 240, height: 32))
    let area = CGRect(x: 0, y: 70, width: 1512, height: 880)
    let slots = CaptureCardLayout.slots(
      [CGSize(width: 240, height: 150), CGSize(width: 105, height: 168)], in: area)
    XCTAssertEqual(
      slots,
      [
        CGRect(x: 1256, y: 266, width: 240, height: 150),
        CGRect(x: 1391, y: 86, width: 105, height: 168),
      ])
    XCTAssertEqual(CaptureCardLayout.slots([], in: area), [])
  }

  func testCardButtonsSitInARowWithCloseInTheCorner() {
    let buttons = CaptureCardLayout.buttons(
      [.copy, .save, .edit, .close], size: CGSize(width: 240, height: 150))
    XCTAssertEqual(buttons.map { $0.0 }, [.copy, .save, .edit, .close])
    XCTAssertEqual(
      buttons.map { $0.1 },
      [
        CGRect(x: 67, y: 60, width: 30, height: 30), CGRect(x: 105, y: 60, width: 30, height: 30),
        CGRect(x: 143, y: 60, width: 30, height: 30), CGRect(x: 6, y: 122, width: 22, height: 22),
      ])
    // A sliver of a card keeps only ✕.
    let thin = CaptureCardLayout.buttons(
      [.copy, .save, .close], size: CGSize(width: 240, height: 32))
    XCTAssertEqual(thin.map { $0.0 }, [.close])
  }

  func testTheRecordingCapsuleWithoutAPenGivesItsRoomToTheClock() {
    let withPen = AnnotateCapsuleLayout.make(asking: false)
    let without = AnnotateCapsuleLayout.make(asking: false, pen: false)
    XCTAssertEqual(without.targets.map { $0.0 }, [.stop, .discard])
    XCTAssertEqual(without.targets.map { $0.1 }, Array(withPen.targets.map { $0.1 }.dropFirst()))
    XCTAssertEqual(without.clock.maxX, without.divider.minX - 6)
    XCTAssertGreaterThan(without.clock.width, withPen.clock.width)
    XCTAssertEqual(AnnotateCapsuleLayout.make(asking: true, pen: false).targets.count, 2)
  }

  func testAGifSamplesAtItsFpsWithDelaysThatAddUpToTheMovie() throws {
    let plan = try XCTUnwrap(
      CaptureGifPlan.make(
        duration: 2, fps: 15, maxFrames: 900, width: 1600, height: 1000, maxWidth: 720))
    XCTAssertEqual(plan.frames, 30)
    XCTAssertEqual(plan.fps, 15)
    XCTAssertEqual(plan.times[1], 1.0 / 15, accuracy: 1e-12)
    XCTAssertEqual(plan.width, 720)
    XCTAssertEqual(plan.height, 450)
    XCTAssertEqual(plan.delays[0], 0.07, accuracy: 1e-9)
    XCTAssertEqual(plan.delays[1], 0.06, accuracy: 1e-9)
    XCTAssertEqual(plan.delays[2], 0.07, accuracy: 1e-9)
    XCTAssertEqual(plan.delays.reduce(0, +), 2, accuracy: 1e-9)
  }

  func testALongMovieLowersTheFpsToFitTheFrameLimit() throws {
    let plan = try XCTUnwrap(
      CaptureGifPlan.make(
        duration: 100, fps: 15, maxFrames: 900, width: 640, height: 480, maxWidth: 720))
    XCTAssertEqual(plan.frames, 900)
    XCTAssertEqual(plan.fps, 9, accuracy: 1e-12)
    XCTAssertLessThan(try XCTUnwrap(plan.times.last), 100)
    // Never scaled up.
    XCTAssertEqual(plan.width, 640)
    XCTAssertEqual(plan.height, 480)
  }

  func testAShortMovieIsOneFrameAndNoDelayIsBelowTheFloor() throws {
    let one = try XCTUnwrap(
      CaptureGifPlan.make(
        duration: 0.05, fps: 15, maxFrames: 900, width: 721, height: 405, maxWidth: 720))
    XCTAssertEqual(one.times, [0])
    XCTAssertEqual(one.delays[0], 0.05, accuracy: 1e-9)
    XCTAssertEqual(one.width, 720)
    XCTAssertEqual(one.height, 404)
    let tiny = try XCTUnwrap(
      CaptureGifPlan.make(
        duration: 0.01, fps: 50, maxFrames: 900, width: 10, height: 10, maxWidth: 720))
    XCTAssertEqual(tiny.delays[0], 0.02, accuracy: 1e-9)
    let fast = try XCTUnwrap(
      CaptureGifPlan.make(
        duration: 1, fps: 60, maxFrames: 900, width: 10, height: 10, maxWidth: 720))
    XCTAssertEqual(fast.frames, 50)
    XCTAssertTrue(fast.delays.allSatisfy { abs($0 - 0.02) < 1e-9 })
    XCTAssertNil(
      CaptureGifPlan.make(
        duration: 0, fps: 15, maxFrames: 900, width: 10, height: 10, maxWidth: 720))
  }
}
