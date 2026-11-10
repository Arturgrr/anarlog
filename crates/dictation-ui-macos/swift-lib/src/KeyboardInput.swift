import Carbon
import CoreGraphics
import Foundation

/// One keyboard layout's Unicode key map.
struct KeyboardLayout {
  private let data: CFData

  init?(_ source: TISInputSource) {
    guard let property = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData)
    else { return nil }
    data = Unmanaged<CFData>.fromOpaque(property).takeUnretainedValue()
  }

  /// Text Input Sources must be read on the main thread.
  static func current() -> KeyboardLayout? {
    TISCopyCurrentKeyboardLayoutInputSource().flatMap { KeyboardLayout($0.takeRetainedValue()) }
  }

  static func asciiCapable() -> KeyboardLayout? {
    TISCopyCurrentASCIICapableKeyboardLayoutInputSource().flatMap {
      KeyboardLayout($0.takeRetainedValue())
    }
  }

  /// What `keyCode` types on this layout, with or without Command held.
  func character(for keyCode: CGKeyCode, command: Bool) -> String? {
    guard let bytes = CFDataGetBytePtr(data) else { return nil }
    let layout = UnsafeRawPointer(bytes).assumingMemoryBound(to: UCKeyboardLayout.self)
    var deadKeyState: UInt32 = 0
    var length = 0
    var characters = [UniChar](repeating: 0, count: 4)
    let status = UCKeyTranslate(
      layout, keyCode, UInt16(kUCKeyActionDisplay), command ? UInt32(cmdKey >> 8) : 0,
      UInt32(LMGetKbdType()), OptionBits(kUCKeyTranslateNoDeadKeysMask), &deadKeyState,
      characters.count, &length, &characters)
    guard status == noErr, length > 0 else { return nil }
    return String(utf16CodeUnits: characters, count: length)
  }

  /// The first key that types `character`, ignoring case.
  func keyCode(typing character: String, command: Bool) -> CGKeyCode? {
    (0..<128).lazy.map { CGKeyCode($0) }.first {
      self.character(for: $0, command: command)?.lowercased() == character
    }
  }
}

enum KeyboardInput {
  /// Quartz keeps at most 20 UTF-16 units of a keyboard event's string.
  static let maxUnitsPerEvent = 20

  /// The key that pastes, matched the way AppKit matches Command-V: the Command layer first
  /// ("Dvorak - QWERTY Command" switches to QWERTY there), then the plain layer, then the
  /// ASCII-capable layout for layouts without Latin letters.
  static func pasteKeyCode(
    active: KeyboardLayout?, asciiCapable: @autoclosure () -> KeyboardLayout?
  ) -> CGKeyCode {
    let find = { (layout: KeyboardLayout?) in
      layout?.keyCode(typing: "v", command: true) ?? layout?.keyCode(typing: "v", command: false)
    }
    return find(active) ?? find(asciiCapable()) ?? CGKeyCode(kVK_ANSI_V)
  }

  /// Command-V on the active layout, to post with `post(_:)`.
  static func pasteKeystroke() -> [CGEvent]? {
    let keyCode = pasteKeyCode(active: .current(), asciiCapable: .asciiCapable())
    guard let source = CGEventSource(stateID: .combinedSessionState),
      let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
      let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false)
    else { return nil }
    // Only V carries Command. Posting the Command key itself would read as a tap of it to a
    // double-tap Command dictation shortcut.
    down.flags = .maskCommand
    up.flags = .maskCommand
    return [down, up]
  }

  static func post(_ events: [CGEvent]) {
    for event in events { event.post(tap: .cghidEventTap) }
  }

  enum Stroke: Equatable {
    case text([UniChar])
    case lineBreak
  }

  /// Splits text into events of at most `maxUnitsPerEvent` UTF-16 units without splitting a
  /// surrogate pair. `\r\n`, `\n` and `\r` each become one line break.
  static func strokes(_ text: String) -> [Stroke] {
    var strokes: [Stroke] = []
    var units: [UniChar] = []
    var scalars = text.unicodeScalars.makeIterator()
    var next = scalars.next()
    while let scalar = next {
      next = scalars.next()
      if scalar == "\r" || scalar == "\n" {
        if scalar == "\r" && next == "\n" { next = scalars.next() }
        if !units.isEmpty { strokes.append(.text(units)) }
        units = []
        strokes.append(.lineBreak)
        continue
      }
      let encoded = Array(String(scalar).utf16)
      if units.count + encoded.count > maxUnitsPerEvent {
        strokes.append(.text(units))
        units = []
      }
      units += encoded
    }
    if !units.isEmpty { strokes.append(.text(units)) }
    return strokes
  }

  /// Types text without the clipboard. Line breaks are Shift-Return, so chat boxes insert a
  /// newline instead of sending.
  static func type(_ text: String) -> Bool {
    guard let source = CGEventSource(stateID: .combinedSessionState) else { return false }
    var events: [CGEvent] = []
    for stroke in strokes(text) {
      for keyDown in [true, false] {
        let keyCode = stroke == .lineBreak ? CGKeyCode(kVK_Return) : 0
        guard let event = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: keyDown)
        else { return false }
        if case .text(let units) = stroke {
          event.flags = []
          event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
        } else {
          event.flags = .maskShift
        }
        events.append(event)
      }
    }
    // Every event exists before any is posted, so a failure never types part of the text.
    post(events)
    return true
  }

  /// Waits for the keys of the dictation shortcut to come up, so a held Option or Shift can't turn
  /// Command-V into another shortcut. Blocks the calling thread; never call it on the main thread.
  static func waitForModifierRelease(timeout: TimeInterval = 2) -> Bool {
    let held: CGEventFlags = [.maskCommand, .maskAlternate, .maskControl, .maskShift, .maskSecondaryFn]
    let deadline = Date().addingTimeInterval(timeout)
    while !CGEventSource.flagsState(.hidSystemState).intersection(held).isEmpty {
      if Date() >= deadline { return false }
      Thread.sleep(forTimeInterval: 0.01)
    }
    return true
  }
}
