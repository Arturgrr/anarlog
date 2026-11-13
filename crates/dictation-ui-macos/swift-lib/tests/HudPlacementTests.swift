import CoreGraphics
import XCTest

@testable import swift_lib

// Ported from the tests of Hex's `src/rune_hud/hud_placement.rs` (MIT,
// © 2026 Christopher Langton).

final class HudPlacementTests: XCTestCase {
  private let panel = CGSize(width: 560, height: 128)
  private let plate: CGFloat = 26

  /// A 1512 × 982 point 14-inch MacBook Pro: a 32 pt notch 185 pt wide, the
  /// Dock 70 pt tall.
  private let notched = HudScreen(
    frame: CGRect(x: 0, y: 0, width: 1512, height: 982),
    visibleFrame: CGRect(x: 0, y: 70, width: 1512, height: 880), safeTop: 32, auxLeft: 663.5,
    auxRight: 663.5)

  /// A 2560 × 1440 flat display left of the main one, its menu bar 24 pt.
  private let flat = HudScreen(
    frame: CGRect(x: -2560, y: 0, width: 2560, height: 1440),
    visibleFrame: CGRect(x: -2560, y: 0, width: 2560, height: 1416), safeTop: 0)

  /// The plate's middle on screen.
  private func plateMiddle(_ placed: HudPlaced) -> CGPoint {
    CGPoint(x: placed.origin.x + panel.width / 2, y: placed.origin.y + panel.height / 2)
  }

  func testOnlyAScreenWithANotchHasOne() {
    XCTAssertEqual(
      HudPlacement.notch(of: notched), HudNotch(midX: 756, width: 185, height: 32))
    XCTAssertNil(HudPlacement.notch(of: flat))
    // An inset with no menu bar either side of it is no notch.
    var insetOnly = notched
    insetOnly.auxLeft = 0
    XCTAssertNil(HudPlacement.notch(of: insetOnly))
  }

  func testTopHangsSixPointsUnderTheMenuBarWithTheLiveTextBelow() {
    let placed = HudPlacement.place(.top, on: flat, panel: panel, plateHeight: plate)
    XCTAssertEqual(plateMiddle(placed), CGPoint(x: -1280, y: 1416 - 6 - 13))
    XCTAssertEqual(placed.look, .scope(bottom: false))
    XCTAssertFalse(placed.overMenuBar)
    // 6 pt under the plate, which spans 51...77 in the panel.
    XCTAssertEqual(placed.liveTextY + HudPlacement.liveTextHeight, 51 - 6)
  }

  func testTopClearsTheNotchWhenFullScreenHidesTheMenuBar() {
    var fullScreen = notched
    fullScreen.visibleFrame = notched.frame
    let placed = HudPlacement.place(.top, on: fullScreen, panel: panel, plateHeight: plate)
    XCTAssertEqual(plateMiddle(placed).y, 982 - 32 - 6 - 13)
  }

  func testBottomSitsAboveTheDockWithTheLiveTextAbove() {
    let placed = HudPlacement.place(.bottom, on: notched, panel: panel, plateHeight: plate)
    XCTAssertEqual(plateMiddle(placed), CGPoint(x: 756, y: 70 + 24 + 13))
    XCTAssertEqual(placed.look, .scope(bottom: true))
    XCTAssertFalse(placed.overMenuBar)
    XCTAssertEqual(placed.liveTextY, 77 + 6)
    XCTAssertLessThanOrEqual(placed.liveTextY + HudPlacement.liveTextHeight, panel.height)
  }

  func testTheNotchGrowsEarsAndAFlatScreenFallsBackToTop() {
    let placed = HudPlacement.place(.notch, on: notched, panel: panel, plateHeight: plate)
    let notch = HudNotch(midX: 756, width: 185, height: 32)
    XCTAssertEqual(placed.look, .ears(notch))
    XCTAssertTrue(placed.overMenuBar)
    // Centred on the notch, hanging from the screen's top edge.
    XCTAssertEqual(placed.origin, CGPoint(x: 756 - 280, y: 982 - 128))
    // The live text 6 pt under the island.
    XCTAssertEqual(placed.liveTextY + HudPlacement.liveTextHeight, 128 - 32 - 6)
    XCTAssertEqual(
      HudPlacement.place(.notch, on: flat, panel: panel, plateHeight: plate),
      HudPlacement.place(.top, on: flat, panel: panel, plateHeight: plate))
  }

  func testEarsWidenTheNotchSidewaysAtItsOwnHeight() {
    let notch = HudNotch(midX: 756, width: 185, height: 32)
    let closed = HudEars.island(notch: notch, open: 0, maxWidth: 558)
    XCTAssertEqual(closed.width, 185)
    XCTAssertEqual(closed.radius, 8)
    let open = HudEars.island(notch: notch, open: 1, maxWidth: 558)
    XCTAssertEqual(open.width, 185 + 2 * 34)
    XCTAssertEqual(open.radius, 14)
    XCTAssertEqual(HudEars.island(notch: notch, open: -0.2, maxWidth: 558).width, 185)
    XCTAssertEqual(HudEars.island(notch: notch, open: 1, maxWidth: 200).width, 200)
    // Each glyph in the middle of its ear.
    XCTAssertEqual(HudEars.glyphInset(notch: notch), 92.5 + 17 - 1)
    XCTAssertEqual(HudEars.room(notch: notch, width: open.width), 1)
    XCTAssertEqual(HudEars.room(notch: notch, width: closed.width), 0)
  }

  func testTheIslandHangsFromTheTopEdgeWithFilletsEitherSide() {
    let path = HudEars.islandPath(midX: 280, top: 32, width: 253, height: 32, radius: 14)
    let box = path.boundingBoxOfPath
    XCTAssertEqual(box.minX, 280 - 126.5 - 6, accuracy: 0.001)
    XCTAssertEqual(box.maxX, 280 + 126.5 + 6, accuracy: 0.001)
    XCTAssertEqual(box.minY, 0, accuracy: 0.001)
    XCTAssertEqual(box.maxY, 32, accuracy: 0.001)
    // Black under the camera, nothing in the fillets' hollow below the top.
    XCTAssertTrue(path.contains(CGPoint(x: 280, y: 16)))
    XCTAssertFalse(path.contains(CGPoint(x: 280 - 126.5 - 5, y: 27)))
    XCTAssertFalse(path.contains(CGPoint(x: 280 - 126.5 + 1, y: 1)))
  }

  func testBarsFollowTheVoiceOnlyWhileRecordingAndTheSpinnerHoldsStillWithReduceMotion() {
    for index in 0..<5 {
      let silent = HudEars.barHeight(
        index: index, level: 0, clock: 0.3, recording: true, reduceMotion: false)
      let working = HudEars.barHeight(
        index: index, level: 1, clock: 0.3, recording: false, reduceMotion: false)
      XCTAssertEqual(silent, 2.4)
      XCTAssertEqual(working, 2.4)
    }
    XCTAssertEqual(
      HudEars.barHeight(index: 2, level: 1, clock: 0.3, recording: true, reduceMotion: true), 12.4,
      accuracy: 0.001)
    XCTAssertEqual(
      HudEars.spokeShade(index: 0, clock: 0, reduceMotion: false), 1, accuracy: 0.001)
    XCTAssertEqual(
      HudEars.spokeShade(index: 3, clock: 0.9, reduceMotion: true),
      HudEars.spokeShade(index: 3, clock: 0.1, reduceMotion: true))
    XCTAssertNotEqual(
      HudEars.spokeShade(index: 3, clock: 0.9, reduceMotion: false),
      HudEars.spokeShade(index: 3, clock: 0.1, reduceMotion: false))
    XCTAssertEqual(HudEars.pop(clock: 0, reduceMotion: true), 1)
    XCTAssertEqual(HudEars.pop(clock: 1, reduceMotion: false), 1, accuracy: 0.001)
  }
}
