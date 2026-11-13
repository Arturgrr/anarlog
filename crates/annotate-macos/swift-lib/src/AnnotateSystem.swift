// Small pieces over the system: the host clock, a locked box for state
// shared with ScreenCaptureKit's queues, the Screen Recording probe, the
// front app, and image files. The probe follows Hex (MIT, © 2026
// Christopher Langton), `src/capture_host/screen_access.rs`.

import AppKit
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit

/// A value shared between threads behind a lock.
final class AnnotateLocked<Value> {
  private let lock = NSLock()
  private var value: Value

  init(_ value: Value) {
    self.value = value
  }

  func get() -> Value {
    lock.lock()
    defer { lock.unlock() }
    return value
  }

  func set(_ newValue: Value) {
    lock.lock()
    value = newValue
    lock.unlock()
  }

  @discardableResult
  func update<T>(_ body: (inout Value) -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return body(&value)
  }
}

enum AnnotateHostClock {
  static let timebase: AnnotateTimebase = {
    var info = mach_timebase_info_data_t()
    mach_timebase_info(&info)
    return AnnotateTimebase(numer: info.numer, denom: info.denom)
  }()

  static func now() -> UInt64 {
    mach_absolute_time()
  }
}

/// Runs `work` on the main thread, waiting for it; at once when already
/// there. The main thread never waits on the callers' threads, so this
/// can't deadlock.
func annotateOnMain<T>(_ work: () -> T) -> T {
  Thread.isMainThread ? work() : DispatchQueue.main.sync(execute: work)
}

extension AnnotateScreen {
  init?(_ screen: NSScreen) {
    let key = NSDeviceDescriptionKey("NSScreenNumber")
    guard let number = screen.deviceDescription[key] as? NSNumber else { return nil }
    self.init(
      id: number.uint32Value, frame: screen.frame, visibleFrame: screen.visibleFrame,
      safeTop: screen.safeAreaInsets.top, scale: screen.backingScaleFactor)
  }
}

/// Screen Recording as this process can use it now.
///
/// `CGPreflightScreenCaptureAccess` keeps its first answer for the life of
/// the process, so a grant made while the app runs never shows through it
/// (as Hex found). When it says no, TCC's own
/// preflight (as `crates/tcc` reads it) tells never-asked and denied apart
/// without a prompt, and a one-frame ScreenCaptureKit screenshot tells
/// whether this process can record or must restart first.
enum AnnotatePermissions {
  private typealias Preflight = @convention(c) (CFString, CFDictionary?) -> Int

  private static let tccPreflight: Preflight? = {
    let path = "/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC"
    guard let handle = dlopen(path, RTLD_NOW), let symbol = dlsym(handle, "TCCAccessPreflight")
    else {
      return nil
    }
    return unsafeBitCast(symbol, to: Preflight.self)
  }()

  static let settingsURLs = [
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension",
  ]

  /// `granted`, `denied`, `not_determined` or `needs_restart`. Blocks up to
  /// `timeout` for the screenshot; off the main thread.
  static func probe(timeout: Double = 5) -> String {
    if CGPreflightScreenCaptureAccess() { return "granted" }
    // 0 granted, 1 denied, 2 never asked; -1 when TCC can't be read.
    let tcc = tccPreflight?("kTCCServiceScreenCapture" as CFString, nil) ?? -1
    if tcc == 1 { return "denied" }
    if tcc == 2 { return "not_determined" }
    if screenshotWorks(timeout: timeout) { return "granted" }
    return tcc == 0 ? "needs_restart" : "denied"
  }

  /// Shows the system prompt the first time; returns the preflight.
  static func request() -> Bool {
    CGRequestScreenCaptureAccess()
  }

  private static func screenshotWorks(timeout: Double) -> Bool {
    let works = AnnotateLocked(false)
    let done = DispatchSemaphore(value: 0)
    SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) {
      content, _ in
      guard let display = content?.displays.first else {
        done.signal()
        return
      }
      let filter = SCContentFilter(display: display, excludingWindows: [])
      let configuration = SCStreamConfiguration()
      configuration.width = 64
      configuration.height = 40
      SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration) {
        image, _ in
        works.set((image?.width ?? 0) > 0)
        done.signal()
      }
    }
    return done.wait(timeout: .now() + timeout) == .success && works.get()
  }
}

enum AnnotateFront {
  /// The front app and its front window's title. The title comes from the
  /// window list, which shows other apps' titles only with Screen
  /// Recording; it needs nothing else. Main thread.
  static func read() -> AnnotateFrontApp {
    guard let app = NSWorkspace.shared.frontmostApplication else { return AnnotateFrontApp() }
    var front = AnnotateFrontApp(
      name: app.localizedName, bundleId: app.bundleIdentifier, windowTitle: nil)
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]]
    else {
      return front
    }
    // Front to back: the first normal-level window of the app is its front one.
    for window in windows {
      let owner = (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value
      let layer = (window[kCGWindowLayer as String] as? NSNumber)?.intValue
      guard owner == app.processIdentifier, layer == 0 else { continue }
      let title = (window[kCGWindowName as String] as? String)?
        .trimmingCharacters(in: .whitespacesAndNewlines)
      if let title, !title.isEmpty { front.windowTitle = title }
      break
    }
    return front
  }
}

enum AnnotateImages {
  static let jpeg = "public.jpeg"
  static let png = "public.png"

  static func write(_ image: CGImage, to url: URL, type: String, quality: Double? = nil) -> Bool {
    guard
      let destination = CGImageDestinationCreateWithURL(url as CFURL, type as CFString, 1, nil)
    else {
      return false
    }
    var options: [CFString: Any] = [:]
    if let quality { options[kCGImageDestinationLossyCompressionQuality] = quality }
    CGImageDestinationAddImage(destination, image, options as CFDictionary)
    return CGImageDestinationFinalize(destination)
  }
}
