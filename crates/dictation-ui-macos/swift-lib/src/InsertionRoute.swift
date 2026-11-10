import ApplicationServices
import Foundation

/// How dictated text reaches the app that has keyboard focus.
enum InsertionRoute: Equatable {
  /// Replaces the focused field's selection through Accessibility, leaving the clipboard alone.
  case accessibility
  /// Puts the text on the clipboard, posts Command-V, then restores the clipboard.
  case paste
  /// Posts the text as keystrokes.
  case type

  /// Chromium 155 and 156 on macOS can drop a Command-V that races their own pasteboard change
  /// notification, however long the paste waits (fixed in 157).
  static let clipboardRaceChromium = 155...156

  /// Terminals send keystrokes and pastes to a shell. Their Accessibility text is the screen.
  static let terminalBundleIDs: Set<String> = [
    "com.apple.Terminal",
    "com.cmuxterm.app",
    "com.github.wez.wezterm",
    "com.googlecode.iterm2",
    "com.mitchellh.ghostty",
    "com.raphaelamorim.rio",
    "net.kovidgoyal.kitty",
    "org.alacritty",
  ]

  /// The route an app takes whatever is focused in it, or nil when the focused element decides.
  /// Chromium, Electron and Gecko accept Accessibility edits they never apply, so they are never
  /// asked; querying them would also build their accessibility trees.
  static func forApp(_ app: AppTraits) -> InsertionRoute? {
    if app.chromiumMajorVersions.contains(where: clipboardRaceChromium.contains) { return .type }
    // Librelog would have to answer its own Accessibility requests on the blocked main thread.
    if app.isCurrentProcess || app.embedsChromium || app.embedsGecko || app.isTerminal {
      return .paste
    }
    return nil
  }

  /// Accessibility only for an editable native text control. Web content may ignore the edit, or
  /// apply it without telling the page's editor.
  static func forFocus(_ focus: FocusedText?) -> InsertionRoute {
    guard let focus, focus.isTextControl, focus.selectedTextSettable,
      focus.characterCount != nil, !focus.inWebArea
    else { return .paste }
    return .accessibility
  }
}

/// What an app's bundle says about how it handles text input.
struct AppTraits {
  var bundleID: String?
  var isCurrentProcess = false
  /// Electron, CEF and Chromium browsers ship `<Name> Framework.framework`.
  var embedsChromium = false
  /// Every Chromium version in the bundle: a browser that staged an update has two.
  var chromiumMajorVersions: [Int] = []
  /// Firefox and its forks ship Gecko as `Contents/MacOS/XUL`.
  var embedsGecko = false

  var isTerminal: Bool {
    guard let bundleID else { return false }
    return InsertionRoute.terminalBundleIDs.contains(bundleID) || bundleID.hasPrefix("dev.warp.Warp")
  }

  init(bundleID: String?, bundleURL: URL?, isCurrentProcess: Bool) {
    self.bundleID = bundleID
    self.isCurrentProcess = isCurrentProcess
    guard let contents = bundleURL?.appendingPathComponent("Contents") else { return }
    let files = FileManager.default
    embedsGecko = files.fileExists(atPath: contents.appendingPathComponent("MacOS/XUL").path)
    let frameworks = contents.appendingPathComponent("Frameworks")
    for name in (try? files.contentsOfDirectory(atPath: frameworks.path)) ?? []
    where name.hasSuffix("Framework.framework") {
      embedsChromium = true
      // Chromium names its versions `<major>.<minor>.<build>.<patch>`; Electron uses `A`.
      let versions = frameworks.appendingPathComponent(name).appendingPathComponent("Versions")
      chromiumMajorVersions += ((try? files.contentsOfDirectory(atPath: versions.path)) ?? [])
        .compactMap(Self.chromiumMajorVersion)
    }
  }

  static func chromiumMajorVersion(_ version: String) -> Int? {
    let components = version.split(separator: ".", omittingEmptySubsequences: false)
      .compactMap { Int($0) }
    return components.count == 4 ? components[0] : nil
  }
}

/// The focused element, as far as choosing a route needs it.
struct FocusedText {
  var role: String?
  var selectedTextSettable = false
  /// Read before inserting, so the insertion can be checked afterwards.
  var characterCount: Int?
  var inWebArea = false

  var isTextControl: Bool {
    [kAXTextFieldRole, kAXTextAreaRole, kAXComboBoxRole].contains(role ?? "")
  }
}
