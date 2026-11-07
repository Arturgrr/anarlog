import Cocoa

enum Layout {
  static let notificationWidth: CGFloat = 360
  static let notificationHeight: CGFloat = 64
  static let compactFooterHeight: CGFloat = 28
  static let compactIconContainerSize: CGFloat = 36
  static let compactIconSize: CGFloat = 28
  static let expandedNotificationHeight: CGFloat = 380
  static let rightMargin: CGFloat = 24
  static let topMargin: CGFloat = 15
  static let slideInOffset: CGFloat = 10
  static let buttonOverhang: CGFloat = 8
  static let cornerRadius: CGFloat = 8
  static let liquidGlassCornerRadius: CGFloat = 10
  static let buttonCornerRadius: CGFloat = 6
  static let contentPaddingHorizontal: CGFloat = 12
  static let contentPaddingVertical: CGFloat = 9
  static let expandedPaddingHorizontal: CGFloat = 16
  static let expandedPaddingVertical: CGFloat = 14
  static let progressBarHeight: CGFloat = 2.5
  static let progressBarBottomOffset: CGFloat = 4.0
  static let progressBarInset: CGFloat = 12.0
}

enum Timing {
  static let slideIn: TimeInterval = 0.3
  static let expansion: TimeInterval = 0.25
  static let fadeIn: TimeInterval = 0.15
  static let dismiss: TimeInterval = 0.2
  static let buttonPress: TimeInterval = 0.08
  static let hoverFade: TimeInterval = 0.15
}

enum Fonts {
  static let titleSize: CGFloat = 14
  static let titleWeight: NSFont.Weight = .semibold
  static let bodySize: CGFloat = 11
  static let bodyWeight: NSFont.Weight = .regular
  static let buttonSize: CGFloat = 12
  static let buttonWeight: NSFont.Weight = .medium
  static let expandedTitleSize: CGFloat = 15
  static let detailLabelSize: CGFloat = 11
  static let detailValueSize: CGFloat = 12
  static let actionButtonSize: CGFloat = 13
}

enum Colors {
  static let buttonNormalBg = NSColor(calibratedWhite: 1.0, alpha: 1.0).cgColor
  static let buttonPressedBg = NSColor(calibratedWhite: 0.92, alpha: 1.0).cgColor
  static let buttonBorder = NSColor(calibratedWhite: 0.0, alpha: 0.14).cgColor
  static let buttonText = NSColor(calibratedWhite: 0.086, alpha: 1.0)
  static let notificationBg = NSColor(calibratedWhite: 0.98, alpha: 0.85).cgColor
  static let notificationOpaqueBg = NSColor(calibratedWhite: 0.98, alpha: 1.0).cgColor
  static let notificationHairline = NSColor(calibratedWhite: 0.859, alpha: 1.0).cgColor
  static let actionButtonBg = NSColor(calibratedWhite: 0.141, alpha: 1.0).cgColor
  static let actionButtonPressedBg = NSColor(calibratedWhite: 0.345, alpha: 1.0).cgColor
  static let actionButtonDestructiveBg = NSColor(
    calibratedRed: 0.988, green: 0.922, blue: 0.922, alpha: 1.0
  ).cgColor
  static let actionButtonDestructivePressedBg = NSColor(
    calibratedRed: 0.949, green: 0.733, blue: 0.718, alpha: 1.0
  ).cgColor
  static let actionButtonDestructiveText = NSColor(
    calibratedRed: 0.722, green: 0.176, blue: 0.208, alpha: 1.0
  )
  static let compactActionButtonElapsedBg = NSColor(calibratedWhite: 0.949, alpha: 1.0).cgColor
  static let compactActionButtonRemainingBg = NSColor(calibratedWhite: 0.859, alpha: 1.0)
    .cgColor
  static let divider = NSColor(calibratedWhite: 0.0, alpha: 0.10).cgColor
  static let pressedOverlay = NSColor(calibratedWhite: 0.0, alpha: 0.08).cgColor
  static let closeButtonNormalBg = NSColor(calibratedWhite: 1.0, alpha: 0.24).cgColor
  static let closeButtonHoverBg = NSColor(calibratedWhite: 1.0, alpha: 0.38).cgColor
  static let closeButtonPressedBg = NSColor(calibratedWhite: 1.0, alpha: 0.5).cgColor
  static let closeButtonBorder = NSColor.white.withAlphaComponent(0.62).cgColor
  static let progressBarBg = NSColor(calibratedWhite: 0.36, alpha: 0.7).cgColor
}

enum CloseButtonConfig {
  static let size: CGFloat = 22
  static let symbolPointSize: CGFloat = 9.5
  static let positionAdjustment = CGSize(width: -10, height: 10)
}
