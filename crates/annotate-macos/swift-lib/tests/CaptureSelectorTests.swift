import CoreGraphics
import XCTest

@testable import AnnotateMacOS

final class CaptureSelectorTests: XCTestCase {
  /// The main display, and a larger one left of it, a little higher.
  private let displays = [
    CaptureDisplay(id: 1, bounds: CGRect(x: 0, y: 0, width: 1512, height: 982)),
    CaptureDisplay(id: 2, bounds: CGRect(x: -2560, y: -458, width: 2560, height: 1440)),
  ]

  /// Front to back: Safari over Notes, a window on the left display, and
  /// one across both.
  private let windows = [
    CaptureWindow(
      id: 11, pid: 100, frame: CGRect(x: 100, y: 100, width: 800, height: 600), owner: "Safari",
      title: "Apple"),
    CaptureWindow(
      id: 12, pid: 101, frame: CGRect(x: 50, y: 50, width: 1200, height: 800), owner: "Notes",
      title: "Notes"),
    CaptureWindow(
      id: 13, pid: 102, frame: CGRect(x: -2000, y: 0, width: 500, height: 400), owner: "Mail",
      title: nil),
    CaptureWindow(
      id: 14, pid: 103, frame: CGRect(x: -100, y: 700, width: 400, height: 400),
      owner: "Terminal", title: "zsh"),
  ]

  private func make(_ purpose: CapturePurpose, _ mode: CaptureSelectMode = .area)
    -> CaptureSelector
  {
    CaptureSelector(purpose: purpose, mode: mode, displays: displays, windows: windows)
  }

  func testADragMakesAnAreaWithItsSizeBesideThePointer() {
    var selector = make(.screenshot)
    selector.down(CGPoint(x: 10, y: 10), on: 1)
    selector.dragged(CGPoint(x: 300, y: 200))
    XCTAssertEqual(
      selector.scene(on: 1),
      CaptureScene(
        kind: .area, target: CGRect(x: 10, y: 10, width: 290, height: 190), badge: "290 × 190",
        pointer: CGPoint(x: 300, y: 200)))
    XCTAssertEqual(selector.scene(on: 2).kind, .nothing)
    XCTAssertEqual(
      selector.up(CGPoint(x: 300, y: 200)),
      .area(display: 1, rect: CGRect(x: 10, y: 10, width: 290, height: 190)))
  }

  func testADragPastTheDisplaysEdgeStopsAtIt() {
    var selector = make(.recording)
    selector.down(CGPoint(x: 1400, y: 900), on: 1)
    selector.dragged(CGPoint(x: 1700, y: 1100))
    XCTAssertEqual(selector.scene(on: 1).target, CGRect(x: 1400, y: 900, width: 112, height: 82))
    XCTAssertEqual(selector.scene(on: 1).pointer, CGPoint(x: 1512, y: 982))
    XCTAssertEqual(
      selector.up(CGPoint(x: 1700, y: 1100)),
      .area(display: 1, rect: CGRect(x: 1400, y: 900, width: 112, height: 82)))
  }

  func testAClickWithoutADragTakesTheDisplayOnlyWhenRecording() {
    var shot = make(.screenshot)
    shot.down(CGPoint(x: 50, y: 50), on: 1)
    shot.dragged(CGPoint(x: 52, y: 51))
    XCTAssertNil(shot.up(CGPoint(x: 52, y: 51)))
    XCTAssertNil(shot.returnKey())
    // A drag smaller than 36 points a side is a click.
    shot.down(CGPoint(x: 50, y: 50), on: 1)
    XCTAssertNil(shot.up(CGPoint(x: 85, y: 300)))

    var recording = make(.recording)
    recording.down(CGPoint(x: 50, y: 50), on: 2)
    XCTAssertEqual(recording.up(CGPoint(x: 52, y: 51)), .display(2))
    recording.moved(CGPoint(x: 5, y: 5), on: 1)
    XCTAssertEqual(recording.returnKey(), .display(1))
  }

  func testAClickInWindowModePicksTheFrontMostWindowUnderIt() {
    var selector = make(.screenshot, .window)
    selector.moved(CGPoint(x: 150, y: 150), on: 1)
    XCTAssertEqual(
      selector.scene(on: 1),
      CaptureScene(
        kind: .window, target: CGRect(x: 100, y: 100, width: 800, height: 600),
        badge: "Safari — Apple", pointer: CGPoint(x: 150, y: 150)))
    XCTAssertEqual(selector.scene(on: 2).kind, .nothing)
    selector.down(CGPoint(x: 150, y: 150), on: 1)
    XCTAssertEqual(
      selector.up(CGPoint(x: 150, y: 150)),
      .window(
        display: 1, rect: CGRect(x: 100, y: 100, width: 800, height: 600), window: windows[0]))
    selector.down(CGPoint(x: 60, y: 60), on: 1)
    XCTAssertEqual(
      selector.up(CGPoint(x: 60, y: 60)),
      .window(
        display: 1, rect: CGRect(x: 50, y: 50, width: 1200, height: 800), window: windows[1]))
    // On no window: the display.
    selector.moved(CGPoint(x: 1400, y: 900), on: 1)
    XCTAssertEqual(selector.scene(on: 1).kind, .display)
    XCTAssertEqual(selector.scene(on: 1).target, CGRect(x: 0, y: 0, width: 1512, height: 982))
    selector.down(CGPoint(x: 1400, y: 900), on: 1)
    XCTAssertEqual(selector.up(CGPoint(x: 1400, y: 900)), .display(1))
  }

  func testAWindowAcrossTwoDisplaysIsCutToTheOneClicked() {
    var selector = make(.recording, .window)
    selector.down(CGPoint(x: 10, y: 800), on: 1)
    XCTAssertEqual(
      selector.up(CGPoint(x: 10, y: 800)),
      .window(
        display: 1, rect: CGRect(x: 0, y: 700, width: 300, height: 282), window: windows[3]))
    // The same window from the left display: global (-60, 800).
    selector.down(CGPoint(x: 2500, y: 1258), on: 2)
    XCTAssertEqual(
      selector.up(CGPoint(x: 2500, y: 1258)),
      .window(
        display: 2, rect: CGRect(x: 2460, y: 1158, width: 100, height: 282), window: windows[3]))
  }

  func testSpaceSwitchesModesAndDropsTheDrag() {
    var selector = make(.screenshot)
    selector.down(CGPoint(x: 10, y: 10), on: 1)
    selector.dragged(CGPoint(x: 300, y: 300))
    selector.toggleMode()
    XCTAssertEqual(selector.mode, .window)
    XCTAssertNil(selector.press)
    XCTAssertEqual(selector.scene(on: 1).kind, .window)
    selector.toggleMode()
    XCTAssertEqual(selector.mode, .area)
    XCTAssertEqual(selector.scene(on: 1).kind, .nothing)
    // A button that comes up after the switch takes nothing.
    XCTAssertNil(selector.up(CGPoint(x: 300, y: 300)))
  }
}
