import Foundation
import XCTest

@testable import AnnotateMacOS

final class AnnotateReplyTests: XCTestCase {
  func testEveryReplyIsAnEnvelopeRustCanRead() {
    XCTAssertEqual(AnnotateReply.ok("granted"), #"{"ok":true,"value":"granted"}"#)
    XCTAssertEqual(AnnotateReply.ok(AnnotateNothing()), #"{"ok":true,"value":{}}"#)
    XCTAssertEqual(
      AnnotateReply.failure(AnnotateFailure(.notRecording, "nothing is recording")),
      #"{"error":{"code":"not_recording","message":"nothing is recording"},"ok":false}"#)
    XCTAssertEqual(
      AnnotateReply.from(Result<Bool, AnnotateFailure>.failure(AnnotateFailure(.internal, "x"))),
      #"{"error":{"code":"internal","message":"x"},"ok":false}"#)
  }

  func testAnUnreadableRequestIsAnInvalidArgument() {
    let bad = AnnotateReply.decode(AnnotateStartRequest.self, from: #"{"directory":"/tmp"}"#)
    guard case .failure(let failure) = bad else { return XCTFail("decoded \(bad)") }
    XCTAssertEqual(failure.code, .invalidArgument)
    let extract = AnnotateReply.decode(
      AnnotateExtractRequest.self,
      from: #"{"video":"/a/recording.mp4","times_ms":[1200],"dir":"/a/frames"}"#)
    guard case .success(let request) = extract else { return XCTFail("\(extract)") }
    XCTAssertNil(request.videoOffsetMs)
    XCTAssertEqual(request.timesMs, [1200])
  }

  func testTheStopResultCarriesWhatTheHostAndAnnotateCoreRead() throws {
    let result = AnnotateStopResult(
      videoPath: "/a/recording.mp4", startedHostTicks: 2_400_000_000,
      startedHostNs: 100_000_000_000, startedWallMs: 1_763_030_400_000, durationMs: 5_000,
      videoOffsetMs: 41, videoDurationMs: nil,
      display: AnnotateDisplayInfo(
        id: 1, widthPt: 1512, heightPt: 982, scale: 2, widthPx: 3024, heightPx: 1964,
        videoWidth: 2560, videoHeight: 1662),
      frontApp: AnnotateFrontApp(name: "Safari", bundleId: "com.apple.Safari", windowTitle: nil),
      candidates: [AnnotateCandidate(tMs: 0, path: "/a/candidates/00000000.jpg")],
      strokes: [
        AnnotateStroke(mode: .drag, points: [AnnotatePoint(x: 10, y: 20, tMs: 1_200)])
      ], endedBy: "stop", warnings: [])
    let data = try AnnotateReply.encoder().encode(result)
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    XCTAssertEqual(
      Set(object.keys),
      [
        "video_path", "started_host_ticks", "started_host_ns", "started_wall_ms", "duration_ms",
        "video_offset_ms", "display", "front_app", "candidates", "strokes", "ended_by",
        "warnings",
      ])
    XCTAssertEqual(object["started_wall_ms"] as? Int64, 1_763_030_400_000)
    let display = try XCTUnwrap(object["display"] as? [String: Any])
    XCTAssertEqual(
      Set(display.keys),
      [
        "id", "width_pt", "height_pt", "scale", "width_px", "height_px", "video_width",
        "video_height",
      ])
    let front = try XCTUnwrap(object["front_app"] as? [String: Any])
    XCTAssertEqual(Set(front.keys), ["name", "bundle_id"])
    XCTAssertEqual(try JSONDecoder().decode(AnnotateStopResult.self, from: data), result)
  }

  func testCandidateNamesSortByTime() {
    XCTAssertEqual(AnnotateFiles.candidateName(tMs: 1_234), "00001234.jpg")
    XCTAssertEqual(AnnotateFiles.frameName(tMs: 220), "frame-00000220.png")
    let times = [12_345, 220, 1_000, 999]
    XCTAssertEqual(
      times.map(AnnotateFiles.candidateName(tMs:)).sorted(),
      times.sorted().map(AnnotateFiles.candidateName(tMs:)))
  }

  func testRecordingTimesFallInsideTheMovie() {
    // The movie starts 40 ms into the recording and lasts 5 s.
    XCTAssertEqual(AnnotateFiles.videoTime(tMs: 1_000, offsetMs: 40, durationMs: 5_000), 960)
    XCTAssertEqual(AnnotateFiles.videoTime(tMs: 10, offsetMs: 40, durationMs: 5_000), 0)
    XCTAssertEqual(AnnotateFiles.videoTime(tMs: 9_000, offsetMs: 40, durationMs: 5_000), 4_999)
  }

  func testHostTicksBecomeMillisecondsOnAppleSilicon() {
    // 24 MHz ticks: numer 125, denom 3.
    let timebase = AnnotateTimebase(numer: 125, denom: 3)
    XCTAssertEqual(timebase.nanoseconds(24_000_000), 1_000_000_000)
    XCTAssertEqual(timebase.milliseconds(from: 1_000, to: 1_000 + 36_000_000), 1_500)
    XCTAssertEqual(timebase.milliseconds(from: 50, to: 10), 0)
    // A year of uptime neither overflows nor loses whole milliseconds.
    let year: UInt64 = 24_000_000 * 31_536_000
    XCTAssertEqual(timebase.nanoseconds(year), 31_536_000 * 1_000_000_000)
    XCTAssertEqual(AnnotateTimebase(numer: 1, denom: 1).milliseconds(from: 0, to: 2_500_000), 2)
  }
}
