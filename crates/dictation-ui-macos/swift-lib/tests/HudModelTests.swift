import Foundation
import XCTest

@testable import swift_lib

final class HudModelTests: XCTestCase {
  private func decode(_ json: String) throws -> HudEvent {
    try JSONDecoder().decode(HudEvent.self, from: Data(json.utf8))
  }

  /// Steps `model` at 120 fps from `from` to `to`.
  private func run(_ model: HudModel, from: Double, to: Double, reduceMotion: Bool = false) {
    var now = from
    while now < to - 1e-9 {
      now += 1.0 / 120
      model.step(now: now, dt: 1.0 / 120, reduceMotion: reduceMotion)
    }
  }

  /// Records for a second, then the text arrives at once; returns when done
  /// shows.
  private func dictateUntilDone(_ model: HudModel, reduceMotion: Bool = false) -> Double {
    model.handle(.started(position: .top), now: 0, reduceMotion: reduceMotion)
    run(model, from: 0, to: 1, reduceMotion: reduceMotion)
    model.handle(.processing, now: 1, reduceMotion: reduceMotion)
    model.handle(.completed, now: 1, reduceMotion: reduceMotion)
    // Processing shows at least 0.2 s.
    run(model, from: 1, to: 1.25, reduceMotion: reduceMotion)
    XCTAssertEqual(model.earsPose.stage, .done)
    return 1.25
  }

  func testAnOlderBuildsStartAndUnknownPositionsMeanTheTop() throws {
    XCTAssertEqual(try decode(#"{"type":"started"}"#), .started(position: .top))
    XCTAssertEqual(
      try decode(#"{"type":"started","position":"left"}"#), .started(position: .top))
    XCTAssertEqual(
      try decode(#"{"type":"started","position":null}"#), .started(position: .top))
    for position in [HudPosition.top, .bottom, .hidden, .notch] {
      XCTAssertEqual(
        try decode(#"{"type":"started","position":"\#(position.rawValue)"}"#),
        .started(position: position))
    }
  }

  func testDoneShowsLongerInTheNotchAndEveryLookFoldsAway() {
    let scope = HudModel()
    var done = dictateUntilDone(scope)
    XCTAssertTrue(scope.shown)
    run(scope, from: done, to: done + 0.15)
    XCTAssertFalse(scope.shown)
    run(scope, from: done + 0.15, to: done + 3)
    XCTAssertFalse(scope.active)

    let ears = HudModel()
    ears.ears = true
    done = dictateUntilDone(ears)
    run(ears, from: done, to: done + 0.6)
    XCTAssertTrue(ears.shown)
    XCTAssertGreaterThan(ears.earsPose.opacity, 0.99)
    run(ears, from: done + 0.6, to: done + 0.75)
    XCTAssertFalse(ears.shown)
    run(ears, from: done + 0.75, to: done + 3)
    XCTAssertFalse(ears.active)
    XCTAssertLessThan(ears.earsPose.opacity, 0.002)
  }

  func testFailureShowsForSixHundredMillisecondsAndCancelFoldsAtOnce() {
    for notch in [false, true] {
      let model = HudModel()
      model.ears = notch
      model.handle(.started(position: notch ? .notch : .top), now: 0, reduceMotion: false)
      run(model, from: 0, to: 1)
      model.handle(.failed, now: 1, reduceMotion: false)
      run(model, from: 1, to: 1.55)
      XCTAssertTrue(model.shown)
      XCTAssertEqual(model.earsPose.stage, .failed)
      run(model, from: 1.55, to: 1.65)
      XCTAssertFalse(model.shown)
      run(model, from: 1.65, to: 4)
      XCTAssertFalse(model.active)

      model.handle(.started(position: .top), now: 4, reduceMotion: false)
      run(model, from: 4, to: 5)
      model.handle(.cancelled, now: 5, reduceMotion: false)
      run(model, from: 5, to: 5.02)
      XCTAssertFalse(model.shown)
      run(model, from: 5.02, to: 8)
      XCTAssertFalse(model.active)
    }
  }

  /// Hex's notch indicator never showed its check mark with Reduce Motion,
  /// and its ears vanished at once: here every state shows, fading.
  func testWithReduceMotionTheEarsStillShowEachStateAndFadeOut() {
    let model = HudModel()
    model.ears = true
    model.handle(.started(position: .notch), now: 0, reduceMotion: true)
    run(model, from: 0, to: 0.02, reduceMotion: true)
    XCTAssertEqual(model.earsPose.open, 1)
    XCTAssertLessThan(model.earsPose.opacity, 0.9, "fades in rather than appearing at once")
    run(model, from: 0.02, to: 1, reduceMotion: true)
    XCTAssertEqual(model.earsPose.stage, .recording)
    XCTAssertGreaterThan(model.earsPose.opacity, 0.99)
    model.handle(.processing, now: 1, reduceMotion: true)
    run(model, from: 1, to: 1.1, reduceMotion: true)
    XCTAssertEqual(model.earsPose.stage, .processing)
    XCTAssertGreaterThan(model.earsPose.opacity, 0.99)
    model.handle(.completed, now: 1.1, reduceMotion: true)
    let done = 1.25
    run(model, from: 1.1, to: done + 0.3, reduceMotion: true)
    XCTAssertEqual(model.earsPose.stage, .done)
    XCTAssertGreaterThan(model.earsPose.opacity, 0.99)
    run(model, from: done + 0.3, to: done + 0.8, reduceMotion: true)
    XCTAssertEqual(model.earsPose.open, 1, "stays open while it fades")
    XCTAssertGreaterThan(model.earsPose.opacity, 0.002)
    run(model, from: done + 0.8, to: done + 3, reduceMotion: true)
    XCTAssertFalse(model.active)
  }

  /// The setting's Hidden must never stop a dictation, whatever the shader
  /// or the screens: it starts before either is looked at.
  func testAHiddenHudAlwaysStartsAndTakesEveryEvent() {
    let hud = DictationHud()
    XCTAssertTrue(hud.handle(.started(position: .hidden)))
    for event in [HudEvent.preview(stable: "Hi", tentative: ""), .processing, .completed] {
      XCTAssertTrue(hud.handle(event))
    }
  }
}
