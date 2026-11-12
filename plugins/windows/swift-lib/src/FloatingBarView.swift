import AppKit
import SwiftUI

enum FloatingBarLayout {
  static let inset: CGFloat = 4
  static let screenMargin: CGFloat = 8
  static let compactHeight: CGFloat = 38
  static let compactCornerRadius: CGFloat = compactHeight / 2
  static let controlCornerRadius: CGFloat = compactIconSize / 2
  static let compactStopWidth: CGFloat = 62
  static let compactSoloStopWidth: CGFloat = 68
  static let compactIconSize: CGFloat = 30
  static let compactGap: CGFloat = 0
  static let compactHorizontalPadding: CGFloat = 4
  static let expandedWidth: CGFloat = 360
  static let expandedHeight: CGFloat = 430
  static let expandedCornerRadius: CGFloat = 21
  static let expandedPadding: CGFloat = 12
  static let waveformWidth: CGFloat = 26
  static let waveformHeight: CGFloat = 20
  static let stopSquareSize: CGFloat = 9
  static let hoverHandleGap: CGFloat = 2
  static let hoverHandleTopPadding: CGFloat = 7
  static let hoverHandleHeight: CGFloat = 12
  static let hoverHandleReservedHeight: CGFloat =
    hoverHandleTopPadding + hoverHandleHeight + hoverHandleGap
  static let hoverHandleDotSize: CGFloat = 1.6
  static let hoverHandleDotColumnSpacing: CGFloat = 5
  static let hoverHandleDotRowSpacing: CGFloat = 7
  static let hoverHandleHorizontalPadding: CGFloat = 8
  static let dragClickThreshold: CGFloat = 4

  static func compactControlsWidth(showsExpand: Bool) -> CGFloat {
    let stopAndExpand =
      showsExpand ? compactStopWidth + compactGap + compactIconSize : compactSoloStopWidth
    return stopAndExpand + compactGap + compactIconSize
  }

  static func compactWidth(showsExpand: Bool) -> CGFloat {
    compactControlsWidth(showsExpand: showsExpand)
      + compactHorizontalPadding * 2
  }

  static func containerSize(isExpanded: Bool, showsExpand: Bool)
    -> NSSize
  {
    NSSize(
      width: (isExpanded
        ? expandedWidth : compactWidth(showsExpand: showsExpand)) + inset
        * 2,
      height: (isExpanded ? expandedHeight : compactHeight) + hoverHandleReservedHeight + inset * 2)
  }

}

struct FloatingBarView: View {
  @ObservedObject var model: FloatingBarViewModel
  @ObservedObject var settings: FloatingOverlaySettingsModel
  let panelOrigin: () -> NSPoint?
  let movePanel: (NSPoint) -> Void
  @State private var isBarHovered = false
  @State private var isStopHovered = false
  @State private var shouldAutoScrollTranscript = true
  @State private var suppressNextClick = false
  @State private var dragStart: FloatingBarDragStart?
  private let transcriptBottomAnchorId = "floating-transcript-bottom-anchor"
  private let transcriptNoticeId = "floating-transcript-notice"

  private var bodyHeight: CGFloat {
    containerSize.height - FloatingBarLayout.inset * 2 - FloatingBarLayout.hoverHandleReservedHeight
  }

  private var expandsUpward: Bool { model.placement?.expandsUpward ?? true }

  var body: some View {
    let showsHoverHandle = isBarHovered && !model.isExpanded
    let width = containerSize.width - FloatingBarLayout.inset * 2
    let radius =
      model.isExpanded
      ? FloatingBarLayout.expandedCornerRadius : FloatingBarLayout.compactCornerRadius
    let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
    ZStack(alignment: .bottom) {
      if showsHoverHandle {
        FloatingBarHoverHandle(color: dragHandleDotColor, width: width)
          .frame(height: FloatingBarLayout.hoverHandleHeight)
          .padding(.top, FloatingBarLayout.hoverHandleTopPadding)
          .frame(maxHeight: .infinity, alignment: .top)
          .accessibilityHidden(true)
      }
      ZStack(alignment: .topLeading) {
        if model.isExpanded {
          expandedPanel
            .frame(width: width, height: max(0, bodyHeight - FloatingBarLayout.compactHeight))
            .offset(y: expandsUpward ? 0 : FloatingBarLayout.compactHeight)
        }
        floatingControls(isExpanded: model.isExpanded)
          .frame(
            width: FloatingBarLayout.compactControlsWidth(
              showsExpand: model.liveCaptionToggleVisible),
            height: FloatingBarLayout.compactHeight
          )
          .position(
            x: (model.placement?.controlsCenterX ?? containerSize.width / 2)
              - FloatingBarLayout.inset,
            y: expandsUpward
              ? bodyHeight - FloatingBarLayout.compactHeight / 2
              : FloatingBarLayout.compactHeight / 2)
      }
      .frame(width: width, height: bodyHeight, alignment: .topLeading)
    }
    .frame(
      width: width,
      height: bodyHeight + (showsHoverHandle ? FloatingBarLayout.hoverHandleReservedHeight : 0),
      alignment: .bottom
    )
    .background(shape.fill(isBarHovered && !model.isExpanded ? envelopeSurfaceColor : surfaceColor))
    .overlay(shape.strokeBorder(rimColor, lineWidth: 0.5))
    .clipShape(shape)
    .compositingGroup()
    .shadow(color: shadowColor, radius: 1, x: 0, y: 1)
    .padding(FloatingBarLayout.inset)
    .frame(width: containerSize.width, height: containerSize.height, alignment: .bottom)
    .contentShape(Rectangle())
    .simultaneousGesture(dragClickSuppressor)
    .onHover { isBarHovered = $0 }
    .animation(.easeOut(duration: 0.12), value: isBarHovered)
  }

  private var expandedPanel: some View {
    VStack(spacing: 12) {
      ScrollViewReader { proxy in
        ZStack(alignment: .bottom) {
          ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 8) {
              ForEach(Array(model.transcriptBubbles.enumerated()), id: \.element.id) {
                index, bubble in
                TranscriptBubbleView(
                  bubble: bubble,
                  showsSpeakerLabel: showsSpeakerLabel(at: index),
                  colorScheme: model.colorScheme,
                  overlappingSpeechLabel: model.labels.overlappingSpeech
                )
                .id(bubble.id)
              }
              if let notice = model.transcriptNotice {
                Text(notice)
                  .font(.system(size: 12))
                  .foregroundStyle(mutedContentColor)
                  .multilineTextAlignment(.center)
                  .frame(maxWidth: .infinity)
                  .padding(.vertical, 6)
                  .id(transcriptNoticeId)
              }
              Color.clear
                .frame(height: FloatingBarLayout.expandedPadding)
                .id(transcriptBottomAnchorId)
            }
            .frame(maxWidth: .infinity, alignment: .bottom)
            .background(
              TranscriptScrollObserver(isPinnedToBottom: $shouldAutoScrollTranscript)
            )
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .onChange(of: model.transcriptBubbles.last?.id) { _, bubbleId in
            if bubbleId != nil, shouldAutoScrollTranscript {
              scrollTranscriptToBottom(proxy)
            }
          }
          .onChange(of: model.transcriptNotice) { _, notice in
            if notice != nil, shouldAutoScrollTranscript {
              scrollTranscriptToBottom(proxy)
            }
          }
          .onAppear {
            shouldAutoScrollTranscript = true
            scrollTranscriptToBottom(proxy)
          }

          if !shouldAutoScrollTranscript, model.transcriptBubbles.last?.id != nil {
            transcriptBottomChip {
              performClick {
                scrollTranscriptToBottom(proxy, animated: true)
                shouldAutoScrollTranscript = true
              }
            }
            .padding(.bottom, 0)
            .transition(.move(edge: .bottom))
          }
        }
        .animation(.easeOut(duration: 0.12), value: shouldAutoScrollTranscript)
      }
      .padding(.horizontal, FloatingBarLayout.expandedPadding)
      .padding(.vertical, FloatingBarLayout.expandedPadding)
    }
  }

  private func floatingControls(isExpanded: Bool) -> some View {
    HStack(spacing: FloatingBarLayout.compactGap) {
      audioControl(
        width: model.liveCaptionToggleVisible
          ? FloatingBarLayout.compactStopWidth : FloatingBarLayout.compactSoloStopWidth,
        height: FloatingBarLayout.compactIconSize
      )

      if model.liveCaptionToggleVisible {
        FloatingIconButton(
          systemName: isExpanded
            ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right",
          accessibilityLabel: isExpanded
            ? model.labels.collapseTranscript : model.labels.expandTranscript,
          color: primaryContentColor,
          hoverFill: controlHoverFill,
          size: FloatingBarLayout.compactIconSize,
          action: { performClick { setExpanded(!isExpanded) } }
        )
      }

      FloatingIconButton(
        systemName: "xmark",
        accessibilityLabel: model.labels.hideFloatingBar,
        color: mutedContentColor,
        hoverFill: controlHoverFill,
        size: FloatingBarLayout.compactIconSize,
        action: { performClick { settings.hideFloatingBar() } }
      )
      .help(model.labels.hideFloatingBar)
    }
  }

  private func audioControl(width: CGFloat, height: CGFloat) -> some View {
    let shape = RoundedRectangle(
      cornerRadius: FloatingBarLayout.controlCornerRadius,
      style: .continuous
    )

    return Button(action: {
      performClick { RustBridge.stopListening() }
    }) {
      Group {
        if isStopHovered {
          HStack(spacing: 6) {
            Image(systemName: "stop.fill")
              .font(.system(size: FloatingBarLayout.stopSquareSize, weight: .bold))
            Text(model.labels.stop)
              .font(.system(size: 13, weight: .medium))
          }
          .foregroundStyle(dangerColor)
        } else if model.status == .reconnecting {
          ProgressView().controlSize(.small)
            .accessibilityHidden(true)
        } else if model.status == .error {
          ErrorMark(color: dangerColor)
            .frame(
              width: FloatingBarLayout.waveformWidth,
              height: FloatingBarLayout.waveformHeight
            )
        } else {
          DancingBars(color: dangerColor, amplitude: model.amplitude)
            .frame(
              width: FloatingBarLayout.waveformWidth,
              height: FloatingBarLayout.waveformHeight
            )
        }
      }
      .frame(width: width, height: height)
      .background(
        shape
          .fill(isStopHovered ? dangerColor.opacity(0.18) : Color.clear)
      )
      .contentShape(shape)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(
      model.status == .reconnecting
        ? model.labels.reconnectingStopListening
        : model.status == .error
          ? model.labels.errorStopListening
          : model.labels.stopListening
    )
    .help(
      model.status == .error
        ? model.labels.errorHelp
        : model.labels.stopListening
    )
    .onHover { isStopHovered = $0 }
  }

  private var containerSize: NSSize {
    model.placement?.frame.size
      ?? FloatingBarLayout.containerSize(
        isExpanded: model.isExpanded,
        showsExpand: model.liveCaptionToggleVisible
      )
  }

  private var isDark: Bool { model.colorScheme == .dark }

  /// The dictation HUD's plate (`HudPalette`): #191919 in the dark appearance,
  /// white in the light one.
  private var plateColor: Color {
    isDark ? Color(.sRGB, red: 0x19 / 255, green: 0x19 / 255, blue: 0x19 / 255) : .white
  }

  /// The opacity setting, scaled so its default draws the HUD's plate.
  private var surfaceOpacity: Double {
    min(
      settings.floatingBarOpacity / FloatingOverlayOpacity.defaultFloatingBar
        * (isDark ? 0.94 : 0.96), 0.98)
  }

  private var surfaceColor: Color {
    plateColor.opacity(surfaceOpacity)
  }

  private var envelopeSurfaceColor: Color {
    plateColor.opacity(min(surfaceOpacity + 0.04, 0.98))
  }

  private var rimColor: Color {
    isDark ? Color.white.opacity(0.16) : Color.black.opacity(0.12)
  }

  /// The HUD's shadow colour, pulled in to fit the panel's 4 pt inset.
  private var shadowColor: Color {
    Color.black.opacity(isDark ? 0.45 : 0.12)
  }

  /// `--text-base` from the graphite design tokens.
  private var primaryContentColor: Color {
    isDark
      ? Color(.sRGB, red: 0xFA / 255, green: 0xFA / 255, blue: 0xFA / 255)
      : Color(.sRGB, red: 0x16 / 255, green: 0x16 / 255, blue: 0x16 / 255)
  }

  /// `--text-faint` from the graphite design tokens.
  private var mutedContentColor: Color {
    Color(.sRGB, red: 0x80 / 255, green: 0x80 / 255, blue: 0x80 / 255)
  }

  private var controlHoverFill: Color {
    primaryContentColor.opacity(isDark ? 0.08 : 0.07)
  }

  private var dragHandleDotColor: Color {
    primaryContentColor.opacity(isDark ? 0.48 : 0.36)
  }

  /// The only hue on the bar: recording and errors, as Hex's capture capsule.
  private var dangerColor: Color {
    isDark
      ? Color(.sRGB, red: 0xF1 / 255, green: 0x74 / 255, blue: 0x71 / 255)
      : Color(.sRGB, red: 0xB8 / 255, green: 0x2D / 255, blue: 0x35 / 255)
  }

  private var dragClickSuppressor: some Gesture {
    DragGesture(
      minimumDistance: FloatingBarLayout.dragClickThreshold,
      coordinateSpace: .global
    )
    .onChanged { _ in
      suppressNextClick = true

      let mouseLocation = NSEvent.mouseLocation
      let start =
        dragStart
        ?? panelOrigin().map {
          FloatingBarDragStart(panelOrigin: $0, mouseLocation: mouseLocation)
        }

      guard let start else { return }
      dragStart = start

      movePanel(
        NSPoint(
          x: start.panelOrigin.x + mouseLocation.x - start.mouseLocation.x,
          y: start.panelOrigin.y + mouseLocation.y - start.mouseLocation.y
        )
      )
    }
    .onEnded { _ in
      dragStart = nil
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
        suppressNextClick = false
      }
    }
  }

  private func performClick(_ action: () -> Void) {
    if suppressNextClick {
      suppressNextClick = false
      return
    }

    action()
  }

  private func setExpanded(_ expanded: Bool) {
    model.isExpanded = expanded
    settings.setLiveCaptionMinimized(!expanded)
  }

  private func showsSpeakerLabel(at index: Int) -> Bool {
    guard model.transcriptBubbles.indices.contains(index) else { return false }
    guard index > model.transcriptBubbles.startIndex else { return true }

    let bubble = model.transcriptBubbles[index]
    let previousBubble = model.transcriptBubbles[index - 1]
    return bubble.speakerLabel != previousBubble.speakerLabel
      || bubble.isSelf != previousBubble.isSelf
  }

  private func scrollTranscriptToBottom(_ proxy: ScrollViewProxy, animated: Bool = false) {
    DispatchQueue.main.async {
      if animated {
        withAnimation(.easeOut(duration: 0.16)) {
          proxy.scrollTo(transcriptBottomAnchorId, anchor: .bottom)
        }
      } else {
        proxy.scrollTo(transcriptBottomAnchorId, anchor: .bottom)
      }
    }
  }

  private func transcriptBottomChip(action: @escaping () -> Void) -> some View {
    let shape = Capsule(style: .continuous)

    return Button(action: action) {
      HStack(spacing: 6) {
        Image(systemName: "arrow.down")
          .font(.system(size: 10, weight: .semibold))
        Text(model.labels.goToBottom)
          .font(.system(size: 11, weight: .medium))
      }
      .foregroundStyle(primaryContentColor)
      .padding(.horizontal, 12)
      .padding(.vertical, 7)
      .background(
        shape
          .fill(transcriptChipFillColor)
      )
      .overlay(
        shape
          .strokeBorder(transcriptChipStrokeColor, lineWidth: 0.5)
      )
    }
    .buttonStyle(.plain)
    .accessibilityLabel(model.labels.scrollTranscriptToBottom)
  }

  /// `--surface-raised-base` from the graphite design tokens.
  private var transcriptChipFillColor: Color {
    isDark
      ? Color(.sRGB, red: 0x23 / 255, green: 0x23 / 255, blue: 0x23 / 255)
      : Color(.sRGB, red: 0xF3 / 255, green: 0xF3 / 255, blue: 0xF3 / 255)
  }

  private var transcriptChipStrokeColor: Color {
    rimColor
  }
}

private struct FloatingBarDragStart {
  let panelOrigin: NSPoint
  let mouseLocation: NSPoint
}

private struct FloatingBarHoverHandle: View {
  let color: Color
  let width: CGFloat

  var body: some View {
    FloatingBarDotPattern(color: color)
      .frame(
        width: max(0, width - FloatingBarLayout.hoverHandleHorizontalPadding * 2),
        height: FloatingBarLayout.hoverHandleHeight
      )
      .padding(.horizontal, FloatingBarLayout.hoverHandleHorizontalPadding)
  }
}

private struct FloatingBarDotPattern: View {
  let color: Color

  var body: some View {
    Canvas { context, size in
      var y = FloatingBarLayout.hoverHandleDotSize / 2
      while y <= size.height {
        var x = FloatingBarLayout.hoverHandleDotSize / 2
        while x <= size.width {
          let rect = CGRect(
            x: x - FloatingBarLayout.hoverHandleDotSize / 2,
            y: y - FloatingBarLayout.hoverHandleDotSize / 2,
            width: FloatingBarLayout.hoverHandleDotSize,
            height: FloatingBarLayout.hoverHandleDotSize
          )
          context.fill(Path(ellipseIn: rect), with: .color(color))
          x += FloatingBarLayout.hoverHandleDotColumnSpacing
        }
        y += FloatingBarLayout.hoverHandleDotRowSpacing
      }
    }
  }
}

private struct TranscriptScrollObserver: NSViewRepresentable {
  @Binding var isPinnedToBottom: Bool

  func makeCoordinator() -> Coordinator {
    Coordinator()
  }

  func makeNSView(context: Context) -> NSView {
    let view = NSView()
    DispatchQueue.main.async {
      context.coordinator.bind(to: view.enclosingScrollView)
    }
    return view
  }

  func updateNSView(_ view: NSView, context: Context) {
    context.coordinator.isPinnedToBottom = $isPinnedToBottom
    DispatchQueue.main.async {
      context.coordinator.bind(to: view.enclosingScrollView)
    }
  }

  final class Coordinator {
    var isPinnedToBottom: Binding<Bool>?
    private weak var scrollView: NSScrollView?
    private var boundsObserver: NSObjectProtocol?
    private let threshold: CGFloat = 20

    deinit {
      if let boundsObserver {
        NotificationCenter.default.removeObserver(boundsObserver)
      }
    }

    func bind(to scrollView: NSScrollView?) {
      guard self.scrollView !== scrollView else { return }

      if let boundsObserver {
        NotificationCenter.default.removeObserver(boundsObserver)
      }

      self.scrollView = scrollView
      guard let scrollView else { return }

      scrollView.contentView.postsBoundsChangedNotifications = true
      boundsObserver = NotificationCenter.default.addObserver(
        forName: NSView.boundsDidChangeNotification,
        object: scrollView.contentView,
        queue: .main
      ) { [weak self] _ in
        self?.updatePinnedState()
      }

      updatePinnedState()
    }

    func updatePinnedState() {
      guard let scrollView, let documentView = scrollView.documentView else { return }

      let visibleRect = scrollView.documentVisibleRect
      let documentBounds = documentView.bounds
      let isPinned: Bool
      if documentView.isFlipped {
        isPinned = visibleRect.maxY >= documentBounds.maxY - threshold
      } else {
        isPinned = visibleRect.minY <= documentBounds.minY + threshold
      }

      if isPinnedToBottom?.wrappedValue != isPinned {
        isPinnedToBottom?.wrappedValue = isPinned
      }
    }
  }
}

private struct FloatingIconButton: View {
  let systemName: String
  let accessibilityLabel: String
  let color: Color
  let hoverFill: Color
  let size: CGFloat
  let action: () -> Void
  @State private var isHovered = false

  var body: some View {
    let shape = RoundedRectangle(
      cornerRadius: FloatingBarLayout.controlCornerRadius,
      style: .continuous
    )

    return Button(action: action) {
      Image(systemName: systemName)
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(color)
        .frame(width: size, height: size)
        .background(
          shape
            .fill(isHovered ? hoverFill : Color.clear)
        )
        .contentShape(shape)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(accessibilityLabel)
    .onHover { isHovered = $0 }
  }
}

private struct TranscriptBubbleView: View {
  let bubble: FloatingTranscriptBubblePayload
  let showsSpeakerLabel: Bool
  let colorScheme: FloatingBarColorScheme
  let overlappingSpeechLabel: String

  var body: some View {
    HStack {
      if bubble.isSelf {
        Spacer(minLength: 40)
      }

      VStack(alignment: .leading, spacing: 4) {
        if showsSpeakerLabel || isOverlapping {
          HStack(spacing: 4) {
            speakerLabel
            overlapGlyph
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }

        let shape = RoundedRectangle(cornerRadius: 11, style: .continuous)
        Text(bubble.text)
          .font(.system(size: 13, weight: .regular))
          .foregroundStyle(ink)
          .multilineTextAlignment(.leading)
          .frame(maxWidth: .infinity, alignment: .leading)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.horizontal, 11)
          .padding(.vertical, 8)
          .background(shape.fill(bubbleBackground))
          .overlay(
            shape
              .strokeBorder(overlapStrokeColor, lineWidth: isOverlapping ? 1 : 0)
          )
      }

      if !bubble.isSelf {
        Spacer(minLength: 40)
      }
    }
  }

  private var ink: Color {
    colorScheme == .dark
      ? Color(.sRGB, red: 0xFA / 255, green: 0xFA / 255, blue: 0xFA / 255)
      : Color(.sRGB, red: 0x16 / 255, green: 0x16 / 255, blue: 0x16 / 255)
  }

  private var bubbleBackground: Color {
    ink.opacity(
      bubble.isSelf ? (colorScheme == .dark ? 0.12 : 0.08) : (colorScheme == .dark ? 0.07 : 0.045))
  }

  private var speakerLabel: some View {
    Group {
      if showsSpeakerLabel {
        Text(bubble.speakerLabel)
          .font(.system(size: 10, weight: .semibold))
          .foregroundStyle(ink)
          .lineLimit(1)
      }
    }
  }

  private var overlapGlyph: some View {
    Group {
      if isOverlapping {
        Image(systemName: "arrow.left.and.right")
          .font(.system(size: 8, weight: .bold))
          .foregroundStyle(ink.opacity(0.72))
          .frame(width: 12, height: 12)
          .accessibilityLabel(overlappingSpeechLabel)
      }
    }
  }

  private var isOverlapping: Bool {
    bubble.overlapsPrevious || bubble.overlapsNext
  }

  private var overlapStrokeColor: Color {
    ink.opacity(colorScheme == .dark ? 0.26 : 0.2)
  }
}

private struct ErrorMark: View {
  let color: Color

  var body: some View {
    VStack(spacing: 1.5) {
      Capsule(style: .continuous)
        .fill(color)
        .frame(width: 3.2, height: 8)
      Circle()
        .fill(color)
        .frame(width: 3.2, height: 3.2)
    }
  }
}

struct DancingBars: View {
  let color: Color
  let amplitude: Double

  private let barCount = 5
  private let barWidth: CGFloat = 3
  private let barSpacing: CGFloat = 2
  private let minHeight: CGFloat = 4
  private let maxHeight: CGFloat = 20

  var body: some View {
    TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { timeline in
      HStack(spacing: barSpacing) {
        let t = timeline.date.timeIntervalSinceReferenceDate
        ForEach(0..<barCount, id: \.self) { index in
          Capsule(style: .continuous)
            .fill(color)
            .frame(width: barWidth, height: barHeight(index: index, time: t))
        }
      }
      .frame(maxHeight: .infinity, alignment: .center)
    }
  }

  private func barHeight(index: Int, time: TimeInterval) -> CGFloat {
    let normalized = min(max(amplitude, 0), 1)
    let center = Double(barCount - 1) / 2
    let distance = abs(Double(index) - center) / max(center, 1)
    let envelope = 1 - distance * 0.42
    let phase = time * 8.5 + Double(index) * 0.68
    let wave = sin(phase) * 0.5 + 0.5
    let drive = 0.4 + normalized * 0.9
    let height = maxHeight * CGFloat(drive * envelope * (0.4 + wave * 0.6))
    return max(minHeight, min(maxHeight, height))
  }
}
