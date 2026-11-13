import AppKit
import Metal
import QuartzCore

/// The scope's Metal pipeline, its shader compiled from source at runtime.
final class HudRenderer {
  /// Built once, off the main thread when prewarmed.
  static let shared: HudRenderer? = HudRenderer()

  let device: MTLDevice
  private let queue: MTLCommandQueue
  private let pipeline: MTLRenderPipelineState

  private init?() {
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
      return nil
    }
    do {
      let library = try device.makeLibrary(source: hudShaderSource, options: nil)
      let descriptor = MTLRenderPipelineDescriptor()
      descriptor.label = "Dictation scope"
      descriptor.vertexFunction = library.makeFunction(name: "hud_vertex")
      descriptor.fragmentFunction = library.makeFunction(name: "hud_fragment")
      descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
      pipeline = try device.makeRenderPipelineState(descriptor: descriptor)
    } catch {
      NSLog("Dictation HUD: could not build the scope shader: \(error)")
      return nil
    }
    self.device = device
    self.queue = queue
  }

  func draw(into layer: CAMetalLayer, uniforms: HudUniforms, lines: [SIMD2<Float>]) {
    guard let drawable = layer.nextDrawable(), let commands = queue.makeCommandBuffer() else {
      return
    }
    let pass = MTLRenderPassDescriptor()
    pass.colorAttachments[0].texture = drawable.texture
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].storeAction = .store
    pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
    guard let encoder = commands.makeRenderCommandEncoder(descriptor: pass) else { return }
    encoder.setRenderPipelineState(pipeline)
    var uniforms = uniforms
    encoder.setFragmentBytes(&uniforms, length: MemoryLayout<HudUniforms>.stride, index: 0)
    lines.withUnsafeBytes { bytes in
      if let base = bytes.baseAddress {
        encoder.setFragmentBytes(base, length: bytes.count, index: 1)
      }
    }
    encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    encoder.endEncoding()
    commands.present(drawable)
    commands.commit()
  }
}

/// The dictation HUD on macOS: the scope in a click-through panel just
/// below the menu bar or above the Dock of the screen under the pointer, or
/// the notch indicator out of its notch, stepped on the display's refresh.
/// Main thread only.
final class DictationHud: NSObject {
  static let shared = DictationHud()

  private let model = HudModel()
  private var panel: HudPanel?
  private var scopeView: HudMetalView?
  private var earsView: HudEarsView?
  private var liveText: HudLiveTextView?
  private var position = HudPosition.top
  private var placed: HudPlaced?
  private var displayLink: CADisplayLink?
  private var lastTarget: CFTimeInterval?
  private var followTimer: Timer?
  private var observers: [NSObjectProtocol] = []
  private var systemObservers: [NSObjectProtocol] = []
  private var shown = false
  private var dark = false
  private var reduceMotion = false
  private var stable = ""
  private var tentative = ""

  /// Builds the panel now and the shader in the background, so the first
  /// dictation never waits on either.
  func prewarm() {
    DispatchQueue.global(qos: .userInitiated).async { _ = HudRenderer.shared }
    ensurePanel()
  }

  /// Returns false when a `started` HUD can't show. A hidden HUD always
  /// starts: there is nothing to show, so nothing can fail.
  func handle(_ event: HudEvent) -> Bool {
    let now = CACurrentMediaTime()
    if case .started(let position) = event {
      self.position = position
      if position == .hidden {
        hide()
        return true
      }
    } else if position == .hidden {
      return true
    }
    switch event {
    case .started(let position):
      // The notch indicator draws without the scope's shader.
      let renderer = HudRenderer.shared
      if renderer == nil && Self.pointerPlacement(position)?.look.notch == nil {
        NSLog("Dictation HUD: the scope's shader is unavailable")
        return false
      }
      ensurePanel()
      if let renderer {
        scopeView?.metalLayer.device = renderer.device
      }
      dark = Self.systemDark()
      reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
      stable = ""
      tentative = ""
      model.handle(.started(position: position), now: now, reduceMotion: reduceMotion)
      show()
    case .preview(let stable, let tentative):
      self.stable = stable
      self.tentative = tentative
    default:
      model.handle(event, now: now, reduceMotion: reduceMotion)
    }
    layoutLiveText()
    return true
  }

  func meter(rms: Float) {
    model.meter(rms: rms)
  }

  private func ensurePanel() {
    guard panel == nil else { return }
    let panel = HudPanel()
    let content = NSView(frame: NSRect(origin: .zero, size: HudLayout.panelSize))
    let scopeView = HudMetalView(
      frame: NSRect(
        x: (HudLayout.panelWidth - HudLayout.scopeSize.width) / 2, y: 0,
        width: HudLayout.scopeSize.width, height: HudLayout.scopeSize.height))
    let earsView = HudEarsView(frame: .zero)
    earsView.isHidden = true
    let liveText = HudLiveTextView(frame: .zero)
    content.addSubview(scopeView)
    content.addSubview(earsView)
    content.addSubview(liveText)
    panel.contentView = content
    self.panel = panel
    self.scopeView = scopeView
    self.earsView = earsView
    self.liveText = liveText
  }

  private func show() {
    guard let panel, let scopeView else { return }
    place(panel)
    if !shown {
      shown = true
      // The ears' first frame is laid out before the panel shows, so it
      // never shows an earlier dictation's.
      layoutEars()
      panel.orderFrontRegardless()
      scopeView.fitDrawable()
      startObserving()
    }
    if displayLink == nil {
      let link = scopeView.displayLink(target: self, selector: #selector(tick(_:)))
      link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
      link.add(to: .main, forMode: .common)
      displayLink = link
      lastTarget = nil
    }
  }

  private func hide() {
    displayLink?.invalidate()
    displayLink = nil
    followTimer?.invalidate()
    followTimer = nil
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers.removeAll()
    systemObservers.forEach { DistributedNotificationCenter.default().removeObserver($0) }
    systemObservers.removeAll()
    liveText?.isHidden = true
    // Nothing black may stay on screen: the island goes before the panel.
    earsView?.reset()
    earsView?.isHidden = true
    panel?.orderOut(nil)
    placed = nil
    model.ears = false
    shown = false
  }

  @objc private func tick(_ link: CADisplayLink) {
    let dt = link.targetTimestamp - (lastTarget ?? link.timestamp)
    lastTarget = link.targetTimestamp
    model.step(now: CACurrentMediaTime(), dt: dt, reduceMotion: reduceMotion)
    if placed?.look.notch == nil {
      render()
    }
    layoutEars()
    if liveText?.isHidden == false && !model.recording {
      liveText?.isHidden = true
    }
    if !model.active {
      hide()
    }
  }

  private func render() {
    guard let renderer = HudRenderer.shared, let scopeView, let panel else { return }
    let scope = model.scope
    let pose = scope.pose
    let palette = HudPalette(dark: dark, pose: pose)
    let size = scopeView.metalLayer.drawableSize
    let uniforms = HudUniforms(
      metrics0: [
        Float(size.width), Float(size.height), Float(panel.backingScaleFactor), HudTuning.span,
      ],
      metrics1: [pose.width, pose.height, pose.opacity, pose.scale],
      metrics2: [pose.softness, Float(HudTuning.samples), HudTuning.lineWidth, pose.height / 2],
      line: SIMD4(palette.line, 1),
      light: SIMD4(palette.light, 1),
      plate: palette.plate,
      rim: palette.rim,
      shadow: palette.shadow)
    renderer.draw(into: scopeView.metalLayer, uniforms: uniforms, lines: scope.lines)
  }

  /// The ears for this frame, or none when the HUD isn't the notch
  /// indicator.
  private func layoutEars() {
    guard let earsView, let panel else { return }
    guard model.active, let notch = placed?.look.notch else {
      if !earsView.isHidden {
        earsView.reset()
        earsView.isHidden = true
      }
      return
    }
    earsView.isHidden = false
    earsView.update(pose: model.earsPose, notch: notch, scale: panel.backingScaleFactor)
  }

  private func layoutLiveText() {
    guard let liveText, let panel else { return }
    guard model.recording, let placed else {
      liveText.isHidden = true
      return
    }
    liveText.show(
      stable: stable, tentative: tentative, dark: dark, centerX: HudLayout.panelWidth / 2,
      y: placed.liveTextY, scale: panel.backingScaleFactor)
  }

  /// Where the HUD goes on the screen with the pointer, else the main one.
  private static func pointerPlacement(_ position: HudPosition) -> HudPlaced? {
    let mouse = NSEvent.mouseLocation
    guard
      let screen = NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) })
        ?? NSScreen.main ?? NSScreen.screens.first
    else { return nil }
    let metrics = HudScreen(
      frame: screen.frame, visibleFrame: screen.visibleFrame, safeTop: screen.safeAreaInsets.top,
      auxLeft: width(screen.auxiliaryTopLeftArea), auxRight: width(screen.auxiliaryTopRightArea))
    return HudPlacement.place(
      position, on: metrics, panel: HudLayout.panelSize, plateHeight: CGFloat(HudTuning.height))
  }

  /// A rect's width, 0 when there is none.
  private static func width(_ rect: NSRect?) -> CGFloat {
    max(rect?.width ?? 0, 0)
  }

  /// On the screen with the pointer; while shown, it follows the pointer to
  /// another screen, becoming the notch indicator or the scope as that
  /// screen has a notch or not.
  private func place(_ panel: NSPanel) {
    guard let next = Self.pointerPlacement(position) else { return }
    if panel.frame.origin != next.origin {
      panel.setFrameOrigin(next.origin)
    }
    guard next != placed else { return }
    let level = next.overMenuBar ? HudLayout.overMenuBarLevel : HudLayout.level
    if panel.level != level {
      panel.level = level
    }
    if let notch = next.look.notch {
      earsView?.frame = NSRect(
        x: 0, y: HudLayout.panelSize.height - notch.height, width: HudLayout.panelWidth,
        height: notch.height)
    }
    let ears = next.look.notch != nil
    if !ears && placed?.look.notch != nil {
      // Back from the notch: this dictation's scope, not an old frame.
      render()
    }
    scopeView?.isHidden = ears
    model.ears = ears
    placed = next
    layoutEars()
    layoutLiveText()
  }

  private func startObserving() {
    followTimer = Timer.scheduledTimer(withTimeInterval: HudLayout.followInterval, repeats: true) {
      [weak self] _ in
      guard let self, let panel = self.panel else { return }
      self.place(panel)
    }
    observers.append(
      NotificationCenter.default.addObserver(
        forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
      ) { [weak self] _ in
        guard let self, let panel = self.panel else { return }
        self.place(panel)
      })
    systemObservers.append(
      DistributedNotificationCenter.default().addObserver(
        forName: Notification.Name("AppleInterfaceThemeChangedNotification"), object: nil,
        queue: .main
      ) { [weak self] _ in
        guard let self else { return }
        self.dark = Self.systemDark()
        self.layoutLiveText()
      })
  }

  /// The system's appearance, whatever the app's own theme: Hex's HUD follows
  /// the system.
  private static func systemDark() -> Bool {
    UserDefaults.standard.string(forKey: "AppleInterfaceStyle")?.lowercased() == "dark"
  }
}
