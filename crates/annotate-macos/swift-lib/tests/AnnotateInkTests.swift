import CoreGraphics
import Foundation
import XCTest

@testable import AnnotateMacOS

final class AnnotateInkTests: XCTestCase {
  private let size = CGSize(width: 1512, height: 982)

  func testStrokesStayOnTheDisplayAndTheirTimesNeverGoBack() {
    var recorder = AnnotateStrokeRecorder(size: size)
    recorder.begin(.drag, at: CGPoint(x: -20, y: 10), tMs: 500)
    recorder.add(CGPoint(x: 40, y: 2000), tMs: 480)
    recorder.add(CGPoint(x: 40.2, y: 2000), tMs: 520)
    recorder.add(CGPoint(x: 60, y: 30), tMs: 540)
    recorder.end(tMs: 560)
    XCTAssertNil(recorder.live)
    XCTAssertEqual(
      recorder.strokes,
      [
        AnnotateStroke(
          mode: .drag,
          points: [
            AnnotatePoint(x: 0, y: 10, tMs: 500),
            AnnotatePoint(x: 40, y: 982, tMs: 500),
            AnnotatePoint(x: 60, y: 30, tMs: 540),
          ])
      ])
  }

  func testAClickIsADotButAHoverThatNeverMovedLeavesNoInk() {
    var recorder = AnnotateStrokeRecorder(size: size)
    recorder.begin(.drag, at: CGPoint(x: 5, y: 5), tMs: 0)
    recorder.end(tMs: 10)
    recorder.begin(.hover, at: CGPoint(x: 9, y: 9), tMs: 20)
    recorder.add(CGPoint(x: 9.1, y: 9), tMs: 30)
    // A new stroke ends the live one.
    recorder.begin(.hover, at: CGPoint(x: 100, y: 100), tMs: 40)
    recorder.add(CGPoint(x: 120, y: 100), tMs: 50)
    XCTAssertEqual(recorder.strokes.map(\.mode), [.drag, .hover])
    XCTAssertEqual(recorder.strokes.map(\.points.count), [1, 2])
    XCTAssertNotNil(recorder.live)
  }

  func testLiftedInkHoldsThenFadesAndLiveInkNeverFades() {
    XCTAssertEqual(AnnotateInkLook.alpha(ageMs: 0), 1)
    XCTAssertEqual(AnnotateInkLook.alpha(ageMs: 650), 1)
    XCTAssertEqual(AnnotateInkLook.alpha(ageMs: 650 + 325), 0.25, accuracy: 1e-9)
    XCTAssertEqual(AnnotateInkLook.alpha(ageMs: 1300), 0)

    var recorder = AnnotateStrokeRecorder(size: size)
    recorder.begin(.drag, at: CGPoint(x: 1, y: 1), tMs: 0)
    recorder.add(CGPoint(x: 50, y: 1), tMs: 100)
    recorder.end(tMs: 100)
    recorder.begin(.hover, at: CGPoint(x: 1, y: 50), tMs: 200)
    XCTAssertEqual(AnnotateInkLook.visible(recorder, nowMs: 700).map { $0.alpha }, [1, 1])
    XCTAssertEqual(AnnotateInkLook.visible(recorder, nowMs: 5_000).map { $0.alpha }, [1])
    XCTAssertTrue(AnnotateInkLook.animating(recorder, nowMs: 5_000))
    recorder.end(tMs: 5_000)
    // The hover stroke never moved, so nothing is left to draw or fade.
    XCTAssertFalse(AnnotateInkLook.animating(recorder, nowMs: 5_000))
  }

  func testTheEdgesGlowOnlyAtTheStart() {
    XCTAssertEqual(AnnotateInkLook.glow(ms: 0), 0)
    XCTAssertGreaterThan(AnnotateInkLook.glow(ms: 200), 0.9)
    XCTAssertGreaterThan(AnnotateInkLook.glow(ms: 900), 0)
    XCTAssertEqual(AnnotateInkLook.glow(ms: 1100), 0)
  }

  func testStrokesEncodeWithTheirTimesForAnnotateCore() throws {
    let stroke = AnnotateStroke(
      mode: .hover,
      points: [AnnotatePoint(x: 1.5, y: 2, tMs: 40), AnnotatePoint(x: 3, y: 4, tMs: 90)])
    let data = try AnnotateReply.encoder().encode(stroke)
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    XCTAssertEqual(Set(object.keys), ["mode", "points", "t0_ms", "t1_ms"])
    XCTAssertEqual(object["t0_ms"] as? Int, 40)
    XCTAssertEqual(object["t1_ms"] as? Int, 90)
    let first = try XCTUnwrap((object["points"] as? [[String: Any]])?.first)
    XCTAssertEqual(Set(first.keys), ["x", "y", "t_ms"])
    XCTAssertEqual(first["x"] as? Double, 1.5)
    XCTAssertEqual(try JSONDecoder().decode(AnnotateStroke.self, from: data), stroke)
  }
}
