import Foundation
import XCTest

@testable import AnnotateMacOS

final class CaptureModelTests: XCTestCase {
  private func json<Value: Encodable>(_ value: Value) throws -> String {
    String(decoding: try AnnotateReply.encoder().encode(value), as: UTF8.self)
  }

  private func object<Value: Encodable>(_ value: Value) throws -> [String: Any] {
    let data = try AnnotateReply.encoder().encode(value)
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
  }

  func testAScreenshotRequestTakesTheContractsDefaults() throws {
    let request = try AnnotateReply.decode(
      CaptureScreenshotRequest.self, from: #"{"mode":"area","out_path":"/a/shot.png"}"#
    ).get()
    XCTAssertEqual(request.mode, .area)
    XCTAssertEqual(request.imageFormat, .png)
    XCTAssertEqual(request.quality, 0.9)
    XCTAssertEqual(request.longEdge, 480)
    XCTAssertFalse(request.cursor)
    XCTAssertNil(request.thumbnailPath)
    XCTAssertNil(request.problem())
    XCTAssertEqual(
      request.hints,
      CaptureHints(
        area: "Drag to capture · Space for a window · Esc to cancel",
        window: "Click a window · Space for an area · Esc to cancel"))

    let full = try AnnotateReply.decode(
      CaptureScreenshotRequest.self,
      from: #"{"mode":"window","out_path":"/a/s.jpg","format":"jpeg","jpeg_quality":1.5,"#
        + #""thumbnail_path":"/t/x.png","thumbnail_long_edge":240,"show_cursor":true,"#
        + #""labels":{"area_hint":"Arraste"},"future":1}"#
    ).get()
    XCTAssertEqual(full.imageFormat, .jpeg)
    XCTAssertEqual(full.quality, 1)
    XCTAssertEqual(full.longEdge, 240)
    XCTAssertTrue(full.cursor)
    XCTAssertEqual(full.hints.area, "Arraste")
    XCTAssertEqual(full.hints.window, "Click a window · Space for an area · Esc to cancel")
  }

  func testABadRequestIsAnInvalidArgument() {
    for bad in [
      #"{"mode":"region","out_path":"/a.png"}"#, #"{"mode":"area"}"#,
      #"{"mode":"area","out_path":"/a.png","format":"tiff"}"#, "",
    ] {
      let result = AnnotateReply.decode(CaptureScreenshotRequest.self, from: bad)
      guard case .failure(let failure) = result else { return XCTFail("decoded \(bad)") }
      XCTAssertEqual(failure.code, .invalidArgument)
    }
    let relative = try? AnnotateReply.decode(
      CaptureScreenshotRequest.self, from: #"{"mode":"area","out_path":"shot.png"}"#
    ).get()
    XCTAssertEqual(relative?.problem()?.code, .invalidArgument)
    let close = try? AnnotateReply.decode(CaptureCardCloseRequest.self, from: "{}").get()
    XCTAssertEqual(close?.problem()?.code, .invalidArgument)
    let all = try? AnnotateReply.decode(CaptureCardCloseRequest.self, from: #"{"all":true}"#).get()
    XCTAssertNil(all?.problem())
  }

  func testARecordingRequestTakesTheContractsDefaults() throws {
    let request = try AnnotateReply.decode(
      CaptureRecordRequest.self,
      from: #"{"mode":"fullscreen","out_path":"/a/r.mp4","labels":{"keep":"Manter"}}"#
    ).get()
    XCTAssertEqual(request.frameRate, 30)
    XCTAssertTrue(request.cursor)
    XCTAssertNil(request.microphone)
    XCTAssertEqual(request.countdown, 0)
    XCTAssertEqual(request.maxDuration, 1800)
    XCTAssertEqual(
      request.hints.area,
      "Drag to record · Space for a window · Return for the whole screen · Esc to cancel")
    let capsule = try XCTUnwrap(request.labels).capsule
    XCTAssertEqual(capsule.keep, "Manter")
    XCTAssertEqual(capsule.discard, "Discard")
    XCTAssertEqual(capsule.discardQuestion, "Discard?")

    let gif = try AnnotateReply.decode(
      CaptureGifRequest.self, from: #"{"video":"/a/r.mp4","out_path":"/a/r.gif","max_width":0}"#
    ).get()
    XCTAssertEqual(gif.frameRate, 15)
    XCTAssertEqual(gif.widthLimit, 720)
    XCTAssertEqual(gif.frameLimit, 900)
  }

  func testRepliesEncodeAsTheHostReadsThem() throws {
    let shot = CaptureShot(
      path: "/a/s.png", thumbnailPath: nil, widthPx: 400, heightPx: 300, scale: 2, kind: .area,
      displayId: 1, rect: CaptureRect(CGRect(x: 10, y: 20, width: 200, height: 150)), app: nil,
      windowTitle: nil)
    let captured = try object(CaptureOutcome.done(shot))
    XCTAssertEqual(
      Set(captured.keys),
      [
        "status", "path", "thumbnail_path", "width_px", "height_px", "scale", "kind", "display_id",
        "rect", "app", "window_title",
      ])
    XCTAssertEqual(captured["status"] as? String, "captured")
    XCTAssertTrue(captured["app"] is NSNull)
    XCTAssertEqual(captured["kind"] as? String, "area")
    let rect = try XCTUnwrap(captured["rect"] as? [String: Any])
    XCTAssertEqual(rect["width"] as? Double, 200)
    XCTAssertEqual(try json(CaptureOutcome<CaptureShot>.cancelled), #"{"status":"cancelled"}"#)

    let started = CaptureRecordingStarted(
      kind: .window, displayId: 2, rect: CaptureRect(CGRect(x: 0, y: 0, width: 10, height: 10)),
      widthPx: 20, heightPx: 20, scale: 2)
    XCTAssertEqual(try object(CaptureOutcome.done(started))["status"] as? String, "recording")
    XCTAssertEqual(
      try json(CaptureStatus(phase: .countdown, elapsedMs: 0)),
      #"{"elapsed_ms":0,"phase":"countdown"}"#)
  }

  func testEventsEncodeAsTheHostReadsThem() throws {
    let events = [
      CaptureEvent(.recordStop), CaptureEvent(.recordStopped, reason: "cap"),
      CaptureEvent.card("cap-1-ab12", .edit), CaptureEvent.closed("cap-1-ab12"),
    ]
    XCTAssertEqual(
      try json(events),
      #"[{"type":"record_stop"},{"reason":"cap","type":"record_stopped"},"#
        + #"{"action":"edit","id":"cap-1-ab12","type":"card_action"},"#
        + #"{"id":"cap-1-ab12","type":"card_closed"}]"#)
    let closed = try JSONDecoder().decode(
      CaptureEvent.self, from: Data(#"{"type":"card_closed","id":"cap-2-0f0f"}"#.utf8))
    XCTAssertEqual(closed, CaptureEvent.closed("cap-2-0f0f"))
  }

  func testOneCaptureAtATimeAndNeverBesideAnnotate() {
    var machine = CaptureMachine()
    XCTAssertFalse(machine.reserve(.screenshot, annotateIdle: false))
    XCTAssertTrue(machine.isIdle)
    XCTAssertTrue(machine.reserve(.screenshot, annotateIdle: true))
    XCTAssertEqual(machine.phase, .selecting)
    XCTAssertFalse(machine.reserve(.recording, annotateIdle: true))
    // A screenshot's selector never goes on to a countdown.
    XCTAssertFalse(machine.selected())
    machine.reset()
    XCTAssertTrue(machine.reserve(.recording, annotateIdle: true))
    XCTAssertTrue(machine.selected())
    XCTAssertEqual(machine.phase, .countdown)
    XCTAssertTrue(machine.started(now: 10))
    XCTAssertFalse(machine.reserve(.screenshot, annotateIdle: true))
    XCTAssertTrue(machine.finishing())
    XCTAssertFalse(machine.reserve(.screenshot, annotateIdle: true))
    machine.reset()
    XCTAssertTrue(machine.isIdle)
  }

  func testCancelReachesEveryPhase() {
    var machine = CaptureMachine()
    XCTAssertEqual(machine.requestCancel(), .nothing)
    XCTAssertTrue(machine.reserve(.recording, annotateIdle: true))
    XCTAssertEqual(machine.requestCancel(), .selector)
    // The selector closed by the cancel goes no further.
    XCTAssertFalse(machine.selected())
    machine.reset()

    XCTAssertTrue(machine.reserve(.recording, annotateIdle: true))
    XCTAssertTrue(machine.selected())
    XCTAssertEqual(machine.requestCancel(), .starting)
    XCTAssertFalse(machine.started(now: 1))
    machine.reset()

    XCTAssertTrue(machine.reserve(.recording, annotateIdle: true))
    XCTAssertTrue(machine.selected())
    XCTAssertTrue(machine.started(now: 1))
    XCTAssertEqual(machine.requestCancel(), .recording)
    XCTAssertTrue(machine.finishing())
    XCTAssertEqual(machine.requestCancel(), .finishing)
  }

  func testTheRecordingStopsItselfAtItsCap() {
    var machine = CaptureMachine()
    XCTAssertTrue(machine.reserve(.recording, annotateIdle: true, maxDuration: 60))
    XCTAssertTrue(machine.selected())
    XCTAssertTrue(machine.started(now: 100))
    XCTAssertEqual(machine.elapsedMs(now: 101.5), 1500)
    XCTAssertEqual(machine.tick(now: 159.99), [])
    XCTAssertEqual(machine.tick(now: 160), [.cap])
    XCTAssertTrue(machine.finishing())
    XCTAssertEqual(machine.tick(now: 200), [])
    machine.stoppedByItself(reason: "cap")
    machine.reset()
    XCTAssertEqual(machine.drainEvents(), [CaptureEvent(.recordStopped, reason: "cap")])
    XCTAssertEqual(machine.elapsedMs(now: 300), 0)
  }

  func testTheCapsuleAsksBeforeDiscardingAndQueuesOneStop() {
    var machine = CaptureMachine()
    XCTAssertTrue(machine.reserve(.recording, annotateIdle: true))
    XCTAssertTrue(machine.selected())
    XCTAssertTrue(machine.started(now: 0))
    machine.capsule(.discard, now: 1)
    XCTAssertTrue(machine.asking)
    XCTAssertEqual(machine.tick(now: 5), [.questionClosed])
    machine.capsule(.confirmDiscard, now: 6)
    XCTAssertEqual(machine.drainEvents(), [])
    machine.capsule(.discard, now: 7)
    machine.capsule(.confirmDiscard, now: 8)
    machine.capsule(.stop, now: 9)
    machine.capsule(.stop, now: 9.1)
    XCTAssertEqual(
      machine.drainEvents(), [CaptureEvent(.recordDiscard), CaptureEvent(.recordStop)])
  }

  func testACardWaitsWhileThePointerIsOnIt() {
    var timer = CaptureCardTimer()
    XCTAssertFalse(timer.tick(5, hovered: false))
    XCTAssertFalse(timer.tick(60, hovered: true))
    XCTAssertEqual(timer.remaining, 3)
    XCTAssertFalse(timer.tick(2.5, hovered: false))
    XCTAssertTrue(timer.tick(0.5, hovered: false))
  }
}
