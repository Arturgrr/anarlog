import Carbon
import Cocoa
import IOKit
import SwiftRs

private enum Message {
  static let accessibility =
    "Enable Librelog in System Settings > Privacy & Security > Accessibility to insert dictation into other apps."
  static let secureAtStart =
    "Dictation is unavailable in password fields and while Secure Keyboard Entry is on."
  static let secureAtInsert =
    "Dictation is unavailable in password fields and while Secure Keyboard Entry is on. Copy your last dictation from Settings > Dictation."
  static let shortcutHeld =
    "Release the shortcut keys before inserting text. Copy your last dictation from Settings > Dictation."
  static let failed =
    "Could not insert text. Copy your last dictation from Settings > Dictation."
  static let clipboard =
    "Could not preserve the clipboard. Copy your last dictation from Settings > Dictation."
  static let prepare = "Could not prepare dictation for insertion."
}

private final class DictationPasteProvider: NSObject, NSPasteboardItemDataProvider {
  let text: String
  var didRead: (() -> Void)?
  init(text: String) { self.text = text }
  func pasteboard(
    _ pasteboard: NSPasteboard?, item: NSPasteboardItem,
    provideDataForType type: NSPasteboard.PasteboardType
  ) {
    item.setString(text, forType: type)
    // The pasteboard keeps the text once provided, so later reads never reach the provider.
    // Restore a moment after the first one: apps may read again, or a clipboard manager may have
    // read just before the target.
    guard let didRead else { return }
    self.didRead = nil
    DispatchQueue.main.asyncAfter(deadline: .now() + 1, execute: didRead)
  }
}

extension AXUIElement {
  fileprivate func value(_ attribute: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(self, attribute as CFString, &value) == .success
      ? value : nil
  }

  fileprivate func string(_ attribute: String) -> String? { value(attribute) as? String }

  fileprivate func int(_ attribute: String) -> Int? { (value(attribute) as? NSNumber)?.intValue }

  fileprivate func element(_ attribute: String) -> AXUIElement? {
    guard let value = value(attribute), CFGetTypeID(value) == AXUIElementGetTypeID() else {
      return nil
    }
    let element = unsafeBitCast(value, to: AXUIElement.self)
    AXUIElementSetMessagingTimeout(element, 1)
    return element
  }

  fileprivate func range(_ attribute: String) -> CFRange? {
    guard let value = value(attribute), CFGetTypeID(value) == AXValueGetTypeID() else {
      return nil
    }
    var range = CFRange()
    return AXValueGetValue(unsafeBitCast(value, to: AXValue.self), .cfRange, &range) ? range : nil
  }

  fileprivate func isSettable(_ attribute: String) -> Bool {
    var settable = DarwinBoolean(false)
    return AXUIElementIsAttributeSettable(self, attribute as CFString, &settable) == .success
      && settable.boolValue
  }

  /// Whether the element belongs to a web page. Too deep to tell counts as yes.
  fileprivate var isInWebArea: Bool {
    var current: AXUIElement? = self
    for _ in 0..<32 {
      guard let node = current else { return false }
      let role = node.string(kAXRoleAttribute)
      if role == "AXWebArea" { return true }
      if role == kAXWindowRole || role == kAXApplicationRole { return false }
      current = node.element(kAXParentAttribute)
    }
    return true
  }
}

extension FocusedText {
  fileprivate init(_ element: AXUIElement) {
    role = element.string(kAXRoleAttribute)
    guard isTextControl else { return }
    selectedTextSettable = element.isSettable(kAXSelectedTextAttribute)
    guard selectedTextSettable else { return }
    characterCount = element.int(kAXNumberOfCharactersAttribute)
    inWebArea = element.isInWebArea
  }
}

private enum SecureInput {
  /// Whether `pid` turned on secure keyboard entry: password fields do while focused, and so does
  /// a terminal's Secure Keyboard Entry. Another app holding it, often by mistake, does not block
  /// typing into this one.
  static func isOn(in pid: pid_t) -> Bool {
    guard IsSecureEventInputEnabled() else { return false }
    return owner().map { $0 == pid } ?? true
  }

  /// The process macOS records as having turned secure keyboard entry on for this login session.
  private static func owner() -> pid_t? {
    let entry = IORegistryEntryFromPath(kIOMainPortDefault, "IOService:/IOResources")
    guard entry != 0 else { return nil }
    defer { IOObjectRelease(entry) }
    guard
      let sessions = IORegistryEntryCreateCFProperty(
        entry, "IOConsoleUsers" as CFString, kCFAllocatorDefault, 0)?
        .takeRetainedValue() as? [[String: Any]],
      let session = sessions.first(where: {
        ($0["kCGSSessionUserIDKey"] as? NSNumber)?.uint32Value == getuid()
      }),
      let pid = session["kCGSSessionSecureInputPID"] as? NSNumber
    else { return nil }
    return pid.int32Value
  }
}

/// Where keyboard input goes now: the focused app, and its focused element when that decides how
/// to insert.
private struct Focus {
  let pid: pid_t
  let route: InsertionRoute?
  let element: AXUIElement?

  static func current() -> Focus? {
    guard let pid = focusedPID() else { return nil }
    let running = NSRunningApplication(processIdentifier: pid)
    let app = AppTraits(
      bundleID: running?.bundleIdentifier, bundleURL: running?.bundleURL,
      isCurrentProcess: pid == getpid())
    if let route = InsertionRoute.forApp(app) {
      return Focus(pid: pid, route: route, element: nil)
    }
    let application = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(application, 1)
    return Focus(pid: pid, route: nil, element: application.element(kAXFocusedUIElementAttribute))
  }

  /// Unlike the frontmost app, Accessibility's focused app follows panels such as Spotlight that
  /// take keys without activating.
  private static func focusedPID() -> pid_t? {
    let system = AXUIElementCreateSystemWide()
    AXUIElementSetMessagingTimeout(system, 1)
    var pid: pid_t = 0
    if let app = system.element(kAXFocusedApplicationAttribute),
      AXUIElementGetPid(app, &pid) == .success
    {
      return pid
    }
    return NSWorkspace.shared.frontmostApplication?.processIdentifier
  }

  var isSecure: Bool {
    SecureInput.isOn(in: pid) || element?.string(kAXSubroleAttribute) == kAXSecureTextFieldSubrole
  }

  func resolvedRoute() -> InsertionRoute {
    route ?? InsertionRoute.forFocus(element.map(FocusedText.init))
  }
}

private final class DictationTarget {
  static let shared = DictationTarget()
  var token = ""
  var clipboardSnapshot: [NSPasteboardItem]?
  var clipboardChangeCount: Int?
  var clipboardProvider: DictationPasteProvider?

  /// Text goes wherever focus is when the transcript is ready, so starting only checks what can
  /// already rule dictation out.
  func capture() -> String {
    token = ""
    guard AXIsProcessTrusted() else { return Message.accessibility }
    if Focus.current()?.isSecure == true { return Message.secureAtStart }
    token = UUID().uuidString
    return "ok:" + token
  }

  func insert(token: String, text: String) -> String {
    guard !token.isEmpty, token == self.token else { return Message.failed }
    self.token = ""
    // Posting keystrokes to other apps needs Accessibility too.
    guard AXIsProcessTrusted() else { return Message.accessibility }
    guard let focus = Focus.current() else { return Message.failed }
    if focus.isSecure { return Message.secureAtInsert }

    switch focus.resolvedRoute() {
    case .accessibility:
      if let element = focus.element, insertWithAccessibility(element, text: text) { return "" }
      return paste(text)
    case .paste:
      return paste(text)
    case .type:
      return KeyboardInput.type(text) ? "" : Message.failed
    }
  }

  /// Sets the selected text, then checks the field changed: some apps report success and ignore it.
  private func insertWithAccessibility(_ element: AXUIElement, text: String) -> Bool {
    let count = element.int(kAXNumberOfCharactersAttribute)
    let range = element.range(kAXSelectedTextRangeAttribute)
    guard
      AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, text as CFString)
        == .success
    else { return false }
    if let after = element.int(kAXNumberOfCharactersAttribute), after != count { return true }
    if let range, let after = element.range(kAXSelectedTextRangeAttribute),
      after.location != range.location || after.length != range.length
    {
      return true
    }
    return false
  }

  private func paste(_ text: String) -> String {
    guard let keystroke = KeyboardInput.pasteKeystroke() else { return Message.failed }
    let pasteboard = NSPasteboard.general
    if clipboardChangeCount != pasteboard.changeCount {
      clipboardSnapshot = nil
    }
    var saved = clipboardSnapshot ?? []
    if clipboardSnapshot == nil {
      for original in pasteboard.pasteboardItems ?? [] {
        let copy = NSPasteboardItem()
        for type in original.types {
          guard let data = original.data(forType: type), copy.setData(data, forType: type) else {
            return Message.clipboard
          }
        }
        saved.append(copy)
      }
    }
    let item = NSPasteboardItem()
    let provider = DictationPasteProvider(text: text)
    item.setDataProvider(provider, forTypes: [.string])
    // nspasteboard.org markers: clipboard managers don't record the transcript.
    item.setString("", forType: NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType"))
    item.setString("", forType: NSPasteboard.PasteboardType("org.nspasteboard.TransientType"))
    // Keeps the transcript off Universal Clipboard.
    let clearedCount = pasteboard.prepareForNewContents(with: .currentHostOnly)
    guard pasteboard.writeObjects([item]) else {
      clipboardSnapshot = saved
      clipboardChangeCount = clearedCount
      restoreClipboard(saved, expectedChangeCount: clearedCount, retries: 2)
      return Message.prepare
    }
    let changeCount = pasteboard.changeCount
    clipboardSnapshot = saved
    clipboardChangeCount = changeCount
    clipboardProvider = provider
    provider.didRead = {
      self.restoreClipboard(saved, expectedChangeCount: changeCount, retries: 2)
    }
    // A destination may ignore Command-V and never request the promised text.
    DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
      self.restoreClipboard(saved, expectedChangeCount: changeCount, retries: 2)
    }
    KeyboardInput.post(keystroke)
    return ""
  }

  private func restoreClipboard(_ saved: [NSPasteboardItem], expectedChangeCount: Int, retries: Int)
  {
    guard clipboardChangeCount == expectedChangeCount else { return }
    let pasteboard = NSPasteboard.general
    if pasteboard.changeCount == expectedChangeCount {
      let count = pasteboard.clearContents()
      if !saved.isEmpty && !pasteboard.writeObjects(saved) {
        guard pasteboard.changeCount == count else {
          clipboardSnapshot = nil
          clipboardChangeCount = nil
          clipboardProvider = nil
          return
        }
        clipboardChangeCount = count
        if retries > 0 {
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            self.restoreClipboard(saved, expectedChangeCount: count, retries: retries - 1)
          }
        } else {
          NSLog("Could not restore dictation clipboard; keeping its owned snapshot for recovery.")
        }
        return
      }
    }
    clipboardSnapshot = nil
    clipboardChangeCount = nil
    clipboardProvider = nil
  }

}

private func onMain<T>(_ work: () -> T) -> T {
  Thread.isMainThread ? work() : DispatchQueue.main.sync(execute: work)
}

@_cdecl("_capture_dictation_target")
public func captureDictationTarget() -> SRString {
  SRString(onMain { DictationTarget.shared.capture() })
}

@_cdecl("_insert_dictation_text")
public func insertDictationText(target: SRString, text: SRString) -> SRString {
  let token = target.toString()
  let text = text.toString()
  // Rust calls this off the main thread, so waiting here doesn't stall the indicator.
  guard KeyboardInput.waitForModifierRelease() else { return SRString(Message.shortcutHeld) }
  return SRString(onMain { DictationTarget.shared.insert(token: token, text: text) })
}
