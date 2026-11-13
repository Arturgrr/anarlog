import Foundation
import XCTest

@testable import AnnotateMacOS

final class AnnotateMachineTests: XCTestCase {
  /// A machine recording since `t = 100` s.
  private func recording() -> AnnotateMachine {
    var machine = AnnotateMachine()
    XCTAssertTrue(machine.reserve())
    machine.started(now: 100)
    return machine
  }

  func testOnlyOneRecordingCanBeUnderWayAtATime() {
    var machine = recording()
    XCTAssertFalse(machine.reserve())
    XCTAssertTrue(machine.finishing())
    XCTAssertFalse(machine.reserve())
    machine.reset()
    XCTAssertTrue(machine.reserve())
  }

  func testTheRecordingStopsItselfAtTwentyMinutes() {
    var machine = recording()
    XCTAssertEqual(machine.tick(now: 100 + 20 * 60 - 0.01), [])
    XCTAssertEqual(machine.tick(now: 100 + 20 * 60), [.maxDuration])
    XCTAssertTrue(machine.finishing())
    // Finishing asks nothing more of the session.
    XCTAssertEqual(machine.tick(now: 100 + 21 * 60), [])
    machine.stoppedByItself(reason: "max_duration")
    machine.reset()
    XCTAssertEqual(machine.drainEvents(), [AnnotateEvent(.stopped, reason: "max_duration")])
  }

  func testInkLeftOnWithAStillPointerGoesOffAfterThirtySeconds() {
    var machine = recording()
    machine.setInk(.hover, now: 110)
    machine.pointerMoved(now: 125)
    XCTAssertEqual(machine.tick(now: 154.9), [])
    XCTAssertEqual(machine.ink, .hover)
    XCTAssertEqual(machine.tick(now: 155), [.inkOff])
    XCTAssertEqual(machine.ink, .off)
    XCTAssertEqual(machine.drainEvents(), [AnnotateEvent(.inkOff, reason: "idle")])
    // Off stays off: the timeout never fires twice.
    XCTAssertEqual(machine.tick(now: 300), [])
  }

  func testEscapeTurnsInkOffButNeverStopsTheRecording() {
    var machine = recording()
    XCTAssertFalse(machine.escape())
    machine.capsule(.pen, now: 101)
    XCTAssertEqual(machine.ink, .drag)
    XCTAssertTrue(machine.escape())
    XCTAssertEqual(machine.ink, .off)
    XCTAssertEqual(machine.phase, .recording)
    XCTAssertEqual(
      machine.drainEvents(), [AnnotateEvent(.penOn), AnnotateEvent(.inkOff, reason: "escape")])
  }

  func testInkCanOnlyBeOnWhileRecording() {
    var machine = AnnotateMachine()
    XCTAssertFalse(machine.setInk(.hover, now: 0))
    XCTAssertTrue(machine.reserve())
    XCTAssertFalse(machine.setInk(.drag, now: 0))
    machine.started(now: 1)
    XCTAssertTrue(machine.setInk(.drag, now: 2))
    XCTAssertTrue(machine.finishing())
    XCTAssertEqual(machine.ink, .off)
    XCTAssertFalse(machine.setInk(.hover, now: 3))
  }

  func testDiscardAsksFirstAndAnUnansweredQuestionGoesAway() {
    var machine = recording()
    machine.capsule(.discard, now: 101)
    XCTAssertTrue(machine.asking)
    XCTAssertEqual(machine.drainEvents(), [])
    XCTAssertEqual(machine.tick(now: 104.9), [])
    XCTAssertEqual(machine.tick(now: 105), [.questionClosed])
    XCTAssertFalse(machine.asking)
    // A confirmation with no question showing discards nothing.
    machine.capsule(.confirmDiscard, now: 106)
    XCTAssertEqual(machine.drainEvents(), [])

    machine.capsule(.discard, now: 107)
    machine.capsule(.keep, now: 108)
    XCTAssertFalse(machine.asking)
    machine.capsule(.discard, now: 109)
    machine.capsule(.confirmDiscard, now: 110)
    XCTAssertEqual(machine.drainEvents(), [AnnotateEvent(.discard)])
  }

  func testRepeatedStopClicksQueueOneStop() {
    var machine = recording()
    machine.capsule(.stop, now: 101)
    machine.capsule(.stop, now: 101.1)
    XCTAssertEqual(machine.drainEvents(), [AnnotateEvent(.stop)])
  }

  func testTheClockShowsMinutesAndSeconds() {
    XCTAssertEqual(AnnotateMachine.clock(ms: 7_900), "0:07")
    XCTAssertEqual(AnnotateMachine.clock(ms: 20 * 60_000), "20:00")
    XCTAssertEqual(AnnotateMachine.clock(ms: 3_600_000 + 61_000), "1:01:01")
    XCTAssertEqual(AnnotateMachine.clock(ms: -5), "0:00")
  }

  func testEventsAndStatusEncodeAsTheHostReadsThem() throws {
    let events = [
      AnnotateEvent(.penOn), AnnotateEvent(.inkOff, reason: "idle"),
      AnnotateEvent(.stopped, reason: "stream_error", message: "gone"),
    ]
    let data = try AnnotateReply.encoder().encode(events)
    XCTAssertEqual(
      String(decoding: data, as: UTF8.self),
      #"[{"type":"pen_on"},{"reason":"idle","type":"ink_off"},"#
        + #"{"message":"gone","reason":"stream_error","type":"stopped"}]"#)
    let status = AnnotateStatus(
      phase: .recording, elapsedMs: 1200, ink: .hover, resultPending: false)
    XCTAssertEqual(
      String(decoding: try AnnotateReply.encoder().encode(status), as: UTF8.self),
      #"{"elapsed_ms":1200,"ink":"hover","phase":"recording","result_pending":false}"#)
  }
}
