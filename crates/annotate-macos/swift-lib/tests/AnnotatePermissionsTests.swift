import XCTest

@testable import AnnotateMacOS

final class AnnotatePermissionsTests: XCTestCase {
  func testTheProbeDecidesFromThePreflightTccAndAScreenshot() {
    let unknown = -1
    let cases: [(preflight: Bool, tcc: Int, screenshot: Bool, want: String)] = [
      (true, unknown, false, "granted"),
      (false, 1, true, "denied"),
      (false, 2, true, "not_determined"),
      (false, 0, true, "granted"),
      (false, 0, false, "needs_restart"),
      (false, unknown, true, "granted"),
      // Without TCC's answer the host may ask; macOS prompts at most once.
      (false, unknown, false, "not_determined"),
    ]
    for c in cases {
      let got = AnnotatePermissions.decide(
        preflight: c.preflight, tcc: c.tcc, screenshot: { c.screenshot })
      XCTAssertEqual(got, c.want, "\(c)")
    }
    var shot = false
    _ = AnnotatePermissions.decide(
      preflight: true, tcc: 0,
      screenshot: {
        shot = true
        return true
      })
    XCTAssertFalse(shot, "no screenshot once the preflight says yes")
  }
}
