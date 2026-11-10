import Carbon
import XCTest

@testable import swift_lib

final class TextInsertionTests: XCTestCase {
  /// Key code 9 is V only where V sits on QWERTY. Dvorak moves it, and "Dvorak - QWERTY Command"
  /// switches back to QWERTY while Command is held.
  func testPasteKeyFollowsTheActiveLayoutsCommandLayer() throws {
    let expected: [(String, CGKeyCode)] = [
      ("com.apple.keylayout.US", 9),
      ("com.apple.keylayout.French", 9),
      ("com.apple.keylayout.Dvorak", 47),
      ("com.apple.keylayout.DVORAK-QWERTYCMD", 9),
      ("com.apple.keylayout.Russian", 9),
    ]
    for (id, keyCode) in expected {
      let filter = [kTISPropertyInputSourceID as String: id] as CFDictionary
      let sources = TISCreateInputSourceList(filter, true)?.takeRetainedValue() as? [TISInputSource]
      let layout = try XCTUnwrap(sources?.first.flatMap(KeyboardLayout.init), id)
      XCTAssertEqual(KeyboardInput.pasteKeyCode(active: layout, asciiCapable: nil), keyCode, id)
    }
  }

  /// Electron, Chromium and terminals took the Accessibility path, which reports success without
  /// inserting; Chromium 155 and 156 also drop a pasted Command-V.
  func testAppsWithUnreliableAccessibilityTextNeverUseIt() throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("dictation-route-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    func bundle(_ name: String, _ paths: [String]) throws -> URL {
      let bundle = root.appendingPathComponent(name)
      for path in paths {
        let url = bundle.appendingPathComponent("Contents").appendingPathComponent(path)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
      }
      return bundle
    }
    func route(_ bundleID: String, _ url: URL?) -> InsertionRoute? {
      InsertionRoute.forApp(AppTraits(bundleID: bundleID, bundleURL: url, isCurrentProcess: false))
    }

    let electron = try bundle("Slack.app", ["Frameworks/Electron Framework.framework/Versions/A"])
    let staged = try bundle(
      "Chrome.app",
      [
        "Frameworks/Google Chrome Framework.framework/Versions/156.0.8078.48",
        "Frameworks/Google Chrome Framework.framework/Versions/157.0.8103.15",
      ])
    let fixed = try bundle(
      "Edge.app", ["Frameworks/Microsoft Edge Framework.framework/Versions/157.0.8103.15"])
    let firefox = try bundle("Firefox.app", ["MacOS/XUL"])
    let native = try bundle("TextEdit.app", ["Frameworks/Sparkle.framework/Versions/B"])

    XCTAssertEqual(route("com.tinyspeck.slackmacgap", electron), .paste)
    XCTAssertEqual(route("com.google.Chrome", staged), .type)
    XCTAssertEqual(route("com.microsoft.edgemac", fixed), .paste)
    XCTAssertEqual(route("org.mozilla.firefox", firefox), .paste)
    XCTAssertEqual(route("com.mitchellh.ghostty", nil), .paste)
    XCTAssertNil(route("com.apple.TextEdit", native))

    let field = FocusedText(
      role: kAXTextAreaRole, selectedTextSettable: true, characterCount: 0, inWebArea: false)
    XCTAssertEqual(InsertionRoute.forFocus(field), .accessibility)
    var webField = field
    webField.inWebArea = true
    XCTAssertEqual(InsertionRoute.forFocus(webField), .paste)
    XCTAssertEqual(InsertionRoute.forFocus(nil), .paste)
  }

  /// A Quartz keyboard event carries at most 20 UTF-16 units; a split surrogate pair types
  /// garbage, and a bare Return sends a chat message.
  func testTypedTextKeepsSurrogatePairsWholeAndBreaksLinesWithShiftReturn() {
    let text = { (text: String) in KeyboardInput.Stroke.text(Array(text.utf16)) }
    XCTAssertEqual(
      KeyboardInput.strokes("abcdefghijklmnopqrs😀z\r\nnext\n"),
      [text("abcdefghijklmnopqrs"), text("😀z"), .lineBreak, text("next"), .lineBreak])
  }
}
