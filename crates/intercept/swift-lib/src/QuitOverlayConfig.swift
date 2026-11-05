import Cocoa

enum QuitOverlay {
  static let size = NSSize(width: 360, height: 84)
  static let cornerRadius: CGFloat = 8
  static let verticalOffsetRatio: CGFloat = 0.15
  static let backgroundColor = NSColor(white: 0.141, alpha: 0.92)

  static let messageText = "Press ⌘Q again to Quit"
  static let font = NSFont.systemFont(ofSize: 22, weight: .medium)
  static let primaryTextColor = NSColor(white: 0.929, alpha: 1.0)

  static let animationDuration: TimeInterval = 0.15
  static let overlayDuration: TimeInterval = 1.5
}
