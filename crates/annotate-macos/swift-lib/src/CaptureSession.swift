// One screenshot or recording at a time: the lifecycle machine, the
// selector, the countdown, the recorder with its outline and capsule, and
// what the host reads back. As in `AnnotateSession`, the machine and the
// windows live on the main thread; the host's calls come from its worker
// threads, hop to the main thread only for short steps, and wait for the
// user and ScreenCaptureKit where they are. Events and the status sit
// behind a lock, so polling never waits on the main thread.

import AppKit
import Foundation
import ScreenCaptureKit

enum CaptureTimeouts {
  /// How long a selector may stay up.
  static let selection: Double = 15 * 60
  static let screenshot: Double = 10
}

/// What the start of a capture read on the main thread, before any of
/// its windows showed.
private struct CaptureBegin {
  var screens: [AnnotateScreen]
  var pointer: AnnotateScreen
  var front: AnnotateFrontApp
  /// Front to back, other apps' only.
  var windows: [CaptureWindow]
}

/// What the selector chose, as the recorder and the reply need it.
private struct CaptureTarget {
  var screen: AnnotateScreen
  /// The display's points from its top-left corner.
  var region: CGRect
  var kind: CaptureMode
  var window: CaptureWindow?
}

/// A recording's windows and recorder, from its start to its finish. Main
/// thread.
private final class CaptureRecording {
  let target: CaptureTarget
  let url: URL
  let size: (width: Int, height: Int)
  let outline: CaptureOutlinePanel
  let capsule: AnnotateCapsulePanel
  var recorder: AnnotateRecorder?
  var warnings: [String] = []

  init(target: CaptureTarget, url: URL, size: (width: Int, height: Int), labels: AnnotateLabels) {
    self.target = target
    self.url = url
    self.size = size
    outline = CaptureOutlinePanel(region: target.region, on: target.screen)
    capsule = AnnotateCapsulePanel(screen: target.screen, labels: labels)
    capsule.capsuleView.showsPen = false
  }
}

/// A recording being finished, or finished and not yet claimed.
private final class CaptureFinish {
  let url: URL
  private let group = DispatchGroup()
  private let outcome = AnnotateLocked<Result<CaptureRecordResult, AnnotateFailure>?>(nil)

  init(url: URL) {
    self.url = url
    group.enter()
  }

  var isDone: Bool { outcome.get() != nil }

  func complete(_ result: Result<CaptureRecordResult, AnnotateFailure>) {
    let first = outcome.update { value -> Bool in
      guard value == nil else { return false }
      value = result
      return true
    }
    if first { group.leave() }
  }

  func wait(_ seconds: Double) -> Result<CaptureRecordResult, AnnotateFailure> {
    _ = group.wait(timeout: .now() + seconds)
    return outcome.get()
      ?? .failure(AnnotateFailure(.timeout, "the recording did not finish in time"))
  }
}

/// What a finishing recording hands its worker.
private struct CaptureFinishing {
  var recording: CaptureRecording
  var recorder: AnnotateRecorder
  var durationMs: Int
  var endedBy: String
}

final class CaptureSession {
  static let shared = CaptureSession()

  private struct Mailbox {
    var events: [CaptureEvent] = []
    var phase = CapturePhase.idle
    /// The recording's start on the host clock, in seconds.
    var startedAt: Double?
  }

  private enum FinishStep {
    case run(CaptureFinishing, CaptureFinish)
    case wait(CaptureFinish)
    /// Nothing to finish or wait for.
    case idle
  }

  private let mailbox = AnnotateLocked(Mailbox())
  private let pending = AnnotateLocked<CaptureFinish?>(nil)

  // Main thread only.
  private var machine = CaptureMachine()
  private var selector: CaptureSelectorController?
  private var countdown: CaptureCountdown?
  private var recording: CaptureRecording?
  private var timer: Timer?

  // MARK: Any thread

  func status() -> CaptureStatus {
    let box = mailbox.get()
    var elapsed = 0
    if let startedAt = box.startedAt, box.phase == .recording || box.phase == .finishing {
      elapsed = max(0, Int(((Self.now() - startedAt) * 1000).rounded(.down)))
    }
    return CaptureStatus(phase: box.phase, elapsedMs: elapsed)
  }

  func drainEvents() -> [CaptureEvent] {
    mailbox.update { mailbox in
      defer { mailbox.events.removeAll() }
      return mailbox.events
    }
  }

  /// For the cards, from the main thread.
  func post(_ event: CaptureEvent) {
    mailbox.update { $0.events.append(event) }
  }

  private static func now() -> Double {
    AnnotateHostClock.timebase.seconds(AnnotateHostClock.now())
  }

  // MARK: Main thread

  /// No selector, countdown or recording; Annotate checks this before it
  /// records.
  var isIdle: Bool { machine.isIdle }

  // MARK: Screenshots (worker)

  func screenshot(_ request: CaptureScreenshotRequest) -> Result<
    CaptureOutcome<CaptureShot>, AnnotateFailure
  > {
    if let problem = request.problem() { return .failure(problem) }
    let begin: CaptureBegin
    switch annotateOnMain({ reserve(.screenshot, maxDuration: 0) }) {
    case .success(let value): begin = value
    case .failure(let failure): return .failure(failure)
    }
    defer { annotateOnMain { release() } }

    let content: SCShareableContent
    switch AnnotateSession.shareableContent() {
    case .success(let value): content = value
    case .failure(let failure): return .failure(failure)
    }
    let frozen = request.mode == .fullscreen ? [begin.pointer] : begin.screens
    let images: [UInt32: CGImage]
    switch freeze(frozen, content, cursor: request.cursor) {
    case .success(let value): images = value
    case .failure(let failure): return .failure(failure)
    }

    let target: CaptureTarget
    if request.mode == .fullscreen {
      target = CaptureTarget(
        screen: begin.pointer, region: CGRect(origin: .zero, size: begin.pointer.frame.size),
        kind: .fullscreen, window: nil)
    } else {
      let shown = begin.screens.filter { images[$0.id] != nil }
      let mode: CaptureSelectMode = request.mode == .window ? .window : .area
      switch select(
        .screenshot, mode: mode, screens: shown, images: images, windows: begin.windows,
        hints: request.hints)
      {
      case .failure(let failure):
        return .failure(failure)
      case .success(let selection):
        guard let chosen = Self.target(selection, screens: shown) else {
          return .success(.cancelled)
        }
        target = chosen
      }
    }
    guard let image = images[target.screen.id] else {
      return .failure(AnnotateFailure(.noDisplay, "the display was not captured"))
    }
    return write(image, target, request, front: begin.front).map { CaptureOutcome.done($0) }
  }

  /// Every display in `screens` at its own pixels, this app's chrome left
  /// out. Waits up to `CaptureTimeouts.screenshot`.
  private func freeze(_ screens: [AnnotateScreen], _ content: SCShareableContent, cursor: Bool)
    -> Result<[UInt32: CGImage], AnnotateFailure>
  {
    let images = AnnotateLocked<[UInt32: CGImage]>([:])
    let errors = AnnotateLocked<[Error]>([])
    let group = DispatchGroup()
    let excluded = Self.ownChrome(content, ids: [])
    for screen in screens {
      guard let display = content.displays.first(where: { $0.displayID == screen.id }) else {
        continue
      }
      let filter = SCContentFilter(display: display, excludingWindows: excluded)
      let configuration = SCStreamConfiguration()
      configuration.width = max(Int((screen.frame.width * screen.scale).rounded()), 1)
      configuration.height = max(Int((screen.frame.height * screen.scale).rounded()), 1)
      configuration.showsCursor = cursor
      let id = screen.id
      group.enter()
      SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration) {
        image, error in
        if let image {
          images.update { $0[id] = image }
        } else if let error {
          errors.update { $0.append(error) }
        }
        group.leave()
      }
    }
    _ = group.wait(timeout: .now() + CaptureTimeouts.screenshot)
    let taken = images.get()
    if !taken.isEmpty { return .success(taken) }
    if !CGPreflightScreenCaptureAccess() {
      return .failure(AnnotateFailure(.permission, "Screen Recording is not allowed"))
    }
    if let error = errors.get().first {
      return .failure(AnnotateRecorder.failure(error, "could not capture the screen"))
    }
    return .failure(AnnotateFailure(.timeout, "ScreenCaptureKit did not capture the screen"))
  }

  /// The crop of the frozen display, written with its thumbnail.
  private func write(
    _ image: CGImage, _ target: CaptureTarget, _ request: CaptureScreenshotRequest,
    front: AnnotateFrontApp
  ) -> Result<CaptureShot, AnnotateFailure> {
    let size = target.screen.frame.size
    guard
      let crop = CaptureGeometry.cropRect(
        target.region, display: size, imageWidth: image.width, imageHeight: image.height),
      let picture = image.cropping(to: crop)
    else {
      return .failure(AnnotateFailure(.internal, "the selection is empty"))
    }
    let scale = Double(target.screen.scale)
    let out = URL(fileURLWithPath: request.outPath)
    if let failure = CaptureMedia.createParent(of: out) { return .failure(failure) }
    guard
      CaptureMedia.writeImage(
        picture, to: out, format: request.imageFormat, quality: request.quality, scale: scale)
    else {
      return .failure(AnnotateFailure(.io, "could not write \(out.path)"))
    }
    var thumbnail: String?
    if let path = request.thumbnailPath {
      let url = URL(fileURLWithPath: path)
      if let failure = CaptureMedia.createParent(of: url) { return .failure(failure) }
      guard let small = CaptureMedia.shrunk(picture, longEdge: request.longEdge),
        AnnotateImages.write(small, to: url, type: AnnotateImages.png)
      else {
        return .failure(AnnotateFailure(.io, "could not write \(url.path)"))
      }
      thumbnail = path
    }
    let app = target.window.map { $0.owner } ?? front.name
    let title = target.window.map { $0.title } ?? front.windowTitle
    return .success(
      CaptureShot(
        path: out.path, thumbnailPath: thumbnail, widthPx: picture.width,
        heightPx: picture.height, scale: scale, kind: target.kind, displayId: target.screen.id,
        rect: CaptureRect(target.region), app: app, windowTitle: title))
  }

  // MARK: Recording (worker)

  func recordStart(_ request: CaptureRecordRequest) -> Result<
    CaptureOutcome<CaptureRecordingStarted>, AnnotateFailure
  > {
    if let problem = request.problem() { return .failure(problem) }
    let url = URL(fileURLWithPath: request.outPath)
    if FileManager.default.fileExists(atPath: url.path) {
      return .failure(AnnotateFailure(.invalidArgument, "\(url.path) already exists"))
    }
    if let failure = CaptureMedia.createParent(of: url) { return .failure(failure) }
    let begin: CaptureBegin
    switch annotateOnMain({ reserve(.recording, maxDuration: request.maxDuration) }) {
    case .success(let value): begin = value
    case .failure(let failure): return .failure(failure)
    }
    var running = false
    var wroteMovie = false
    defer {
      if !running {
        annotateOnMain { abortStart() }
        if wroteMovie { try? FileManager.default.removeItem(at: url) }
      }
    }

    let target: CaptureTarget
    if request.mode == .fullscreen {
      target = CaptureTarget(
        screen: begin.pointer, region: CGRect(origin: .zero, size: begin.pointer.frame.size),
        kind: .fullscreen, window: nil)
    } else {
      let mode: CaptureSelectMode = request.mode == .window ? .window : .area
      switch select(
        .recording, mode: mode, screens: begin.screens, images: [:], windows: begin.windows,
        hints: request.hints)
      {
      case .failure(let failure):
        return .failure(failure)
      case .success(let selection):
        guard let chosen = Self.target(selection, screens: begin.screens) else {
          return .success(.cancelled)
        }
        target = chosen
      }
    }
    guard annotateOnMain({ machine.selected() }) else { return .success(.cancelled) }
    if request.countdown > 0 {
      guard runCountdown(request.countdown, on: target.screen) else { return .success(.cancelled) }
    }

    let screen = target.screen
    guard
      let size = CaptureGeometry.recordingSize(
        target.region.size, scale: screen.scale,
        nativeWidth: Int((screen.frame.width * screen.scale).rounded()),
        nativeHeight: Int((screen.frame.height * screen.scale).rounded()))
    else {
      return .failure(AnnotateFailure(.invalidArgument, "the selection is empty"))
    }
    let labels = request.labels?.capsule ?? AnnotateLabels()
    // On screen before the filter is built, so it can leave them out.
    let shownWindows = annotateOnMain { () -> Set<Int>? in
      guard machine.phase == .countdown, !machine.cancelRequested else { return nil }
      let current = CaptureRecording(target: target, url: url, size: size, labels: labels)
      current.outline.orderFrontRegardless()
      current.capsule.orderFrontRegardless()
      recording = current
      return Set([current.outline.windowNumber, current.capsule.windowNumber])
    }
    guard let ownWindows = shownWindows else { return .success(.cancelled) }

    let content: SCShareableContent
    switch AnnotateSession.shareableContent() {
    case .success(let value): content = value
    case .failure(let failure): return .failure(failure)
    }
    guard let display = content.displays.first(where: { $0.displayID == screen.id }) else {
      return .failure(AnnotateFailure(.noDisplay, "the display to record is gone"))
    }
    let filter = SCContentFilter(
      display: display, excludingWindows: Self.ownChrome(content, ids: ownWindows))
    var warnings: [String] = []
    if request.microphone == true {
      warnings.append("the microphone is not recorded: this build records only the screen's sound")
    }
    let whole = target.region == CGRect(origin: .zero, size: screen.frame.size)
    let plan = AnnotateRecordingPlan(
      filter: filter, videoSize: size, candidateSize: (width: 2, height: 2),
      dir: url.deletingLastPathComponent(), anchorTicks: AnnotateHostClock.now(),
      outputURL: url, sourceRect: whole ? nil : target.region,
      frameRate: Int32(request.frameRate), showsCursor: request.cursor, samplesCandidates: false,
      systemAudio: request.systemAudio ?? false)
    let recorder = AnnotateRecorder()
    recorder.onFailure = { _ in
      DispatchQueue.main.async { self.finishByItself(reason: "stream_error") }
    }
    wroteMovie = true
    if let failure = recorder.start(plan) { return .failure(failure) }
    let began = annotateOnMain { () -> Bool in
      guard let current = recording, machine.started(now: Self.now()) else { return false }
      current.recorder = recorder
      current.warnings = warnings
      startTicking(current)
      return true
    }
    guard began else {
      // Cancelled while the stream started.
      _ = recorder.stop()
      return .success(.cancelled)
    }
    running = true
    return .success(
      .done(
        CaptureRecordingStarted(
          kind: target.kind, displayId: screen.id, rect: CaptureRect(target.region),
          widthPx: size.width, heightPx: size.height, scale: Double(screen.scale))))
  }

  func recordStop() -> Result<CaptureRecordResult, AnnotateFailure> {
    let step: FinishStep
    switch annotateOnMain({ beginFinishing(endedBy: "stop") }) {
    case .failure(let failure): return .failure(failure)
    case .success(let value): step = value
    }
    let result: Result<CaptureRecordResult, AnnotateFailure>
    switch step {
    case .run(let finishing, let finish):
      result = runFinish(finishing, finish)
    case .wait(let finish):
      result = finish.wait(AnnotateRecorder.finishTimeout * 2)
    case .idle:
      return .failure(AnnotateFailure(.notRecording, "nothing is recording"))
    }
    claim()
    return result
  }

  /// Ends whatever a recording is at and deletes its movie. Nothing to
  /// cancel is fine.
  func recordCancel() -> Result<AnnotateNothing, AnnotateFailure> {
    let step = annotateOnMain { () -> FinishStep in
      switch machine.requestCancel() {
      case .nothing, .finishing:
        if let finish = pending.get() { return .wait(finish) }
        return .idle
      case .selector:
        selector?.finish(.cancelled)
        return .idle
      case .starting:
        // The start's worker sees the flag and cleans up.
        countdown?.finish(false)
        return .idle
      case .recording:
        switch beginFinishing(endedBy: "cancel") {
        case .success(let next): return next
        case .failure: return .idle
        }
      }
    }
    let finish: CaptureFinish
    switch step {
    case .idle:
      return .success(AnnotateNothing())
    case .run(let finishing, let started):
      _ = runFinish(finishing, started)
      finish = started
    case .wait(let waiting):
      _ = waiting.wait(AnnotateRecorder.finishTimeout * 2)
      finish = waiting
    }
    claim()
    try? FileManager.default.removeItem(at: finish.url)
    return .success(AnnotateNothing())
  }

  /// Shows the selector and waits for it on this worker.
  private func select(
    _ purpose: CapturePurpose, mode: CaptureSelectMode, screens: [AnnotateScreen],
    images: [UInt32: CGImage], windows: [CaptureWindow], hints: CaptureHints
  ) -> Result<CaptureSelection, AnnotateFailure> {
    guard !screens.isEmpty else { return .failure(AnnotateFailure(.noDisplay, "no display")) }
    let answer = AnnotateLocked<CaptureSelection?>(nil)
    let done = DispatchSemaphore(value: 0)
    let shown = annotateOnMain { () -> Bool in
      guard machine.phase == .selecting, !machine.cancelRequested else { return false }
      let displays = screens.map { CaptureDisplay(id: $0.id, bounds: CGDisplayBounds($0.id)) }
      let controller = CaptureSelectorController(
        selector: CaptureSelector(
          purpose: purpose, mode: mode, displays: displays, windows: windows),
        hints: hints)
      selector = controller
      controller.show(screens.map { (screen: $0, image: images[$0.id]) }) { selection in
        answer.set(selection)
        done.signal()
      }
      return true
    }
    guard shown else { return .success(.cancelled) }
    let timedOut = done.wait(timeout: .now() + CaptureTimeouts.selection) == .timedOut
    annotateOnMain {
      selector?.finish(.cancelled)
      selector = nil
    }
    if timedOut {
      return .failure(AnnotateFailure(.timeout, "nothing was selected in 15 minutes"))
    }
    return .success(answer.get() ?? .cancelled)
  }

  /// Counts down on this worker; false when cancelled.
  private func runCountdown(_ seconds: Int, on screen: AnnotateScreen) -> Bool {
    let ranOut = AnnotateLocked(false)
    let done = DispatchSemaphore(value: 0)
    let shown = annotateOnMain { () -> Bool in
      guard machine.phase == .countdown, !machine.cancelRequested else { return false }
      let counter = CaptureCountdown(screen: screen, seconds: seconds) { finished in
        ranOut.set(finished)
        done.signal()
      }
      countdown = counter
      counter.start()
      return true
    }
    guard shown else { return false }
    _ = done.wait(timeout: .now() + Double(seconds) + 5)
    return annotateOnMain { () -> Bool in
      countdown?.finish(false)
      countdown = nil
      return ranOut.get() && machine.phase == .countdown && !machine.cancelRequested
    }
  }

  /// Builds the result from the recorder's outcome; marks the session
  /// idle. On the calling worker.
  private func runFinish(_ finishing: CaptureFinishing, _ finish: CaptureFinish) -> Result<
    CaptureRecordResult, AnnotateFailure
  > {
    let outcome = finishing.recorder.stop()
    let current = finishing.recording
    let result: Result<CaptureRecordResult, AnnotateFailure>
    if let failure = outcome.failure {
      result = .failure(failure)
    } else {
      result = .success(
        CaptureRecordResult(
          videoPath: current.url.path,
          durationMs: outcome.videoDurationMs ?? finishing.durationMs,
          widthPx: current.size.width, heightPx: current.size.height,
          endedBy: finishing.endedBy, warnings: current.warnings + outcome.warnings))
    }
    annotateOnMain {
      finish.complete(result)
      machine.reset()
      if finishing.endedBy == "cap" || finishing.endedBy == "stream_error" {
        machine.stoppedByItself(reason: finishing.endedBy)
      }
      flush()
    }
    return result
  }

  /// The host has the finished recording: nothing pending, and no
  /// `record_stopped` left to tell of it.
  private func claim() {
    pending.set(nil)
    mailbox.update { mailbox in mailbox.events.removeAll { $0.type == .recordStopped } }
  }

  private static func target(_ selection: CaptureSelection, screens: [AnnotateScreen])
    -> CaptureTarget?
  {
    func find(_ id: UInt32) -> AnnotateScreen? { screens.first { $0.id == id } }
    switch selection {
    case .cancelled:
      return nil
    case .area(let display, let rect):
      guard let screen = find(display), !rect.isEmpty else { return nil }
      return CaptureTarget(screen: screen, region: rect, kind: .area, window: nil)
    case .window(let display, let rect, let window):
      guard let screen = find(display) else { return nil }
      if rect.isEmpty {
        return CaptureTarget(
          screen: screen, region: CGRect(origin: .zero, size: screen.frame.size),
          kind: .fullscreen, window: nil)
      }
      return CaptureTarget(screen: screen, region: rect, kind: .window, window: window)
    case .display(let display):
      guard let screen = find(display) else { return nil }
      return CaptureTarget(
        screen: screen, region: CGRect(origin: .zero, size: screen.frame.size),
        kind: .fullscreen, window: nil)
    }
  }

  /// This app's chrome (panels, HUDs, cards: anything above the normal
  /// level) and the windows in `ids`; its normal windows are captured like
  /// any app's.
  private static func ownChrome(_ content: SCShareableContent, ids: Set<Int>) -> [SCWindow] {
    let pid = ProcessInfo.processInfo.processIdentifier
    return content.windows.filter { window in
      window.owningApplication?.processID == pid
        && (window.windowLayer != 0 || ids.contains(Int(window.windowID)))
    }
  }

  // MARK: Main thread steps

  private func reserve(_ purpose: CapturePurpose, maxDuration: Double) -> Result<
    CaptureBegin, AnnotateFailure
  > {
    if purpose == .recording, machine.isIdle, pending.get()?.isDone == true {
      // An unclaimed recording that ended by itself; its movie stays.
      claim()
    }
    guard
      machine.reserve(
        purpose, annotateIdle: AnnotateSession.shared.isIdle, maxDuration: maxDuration)
    else {
      let what = machine.isIdle ? "Annotate is recording" : "a capture is \(machine.phase.rawValue)"
      return .failure(AnnotateFailure(.busy, what))
    }
    if purpose == .recording {
      // A stop or discard left from the last recording is not this one's.
      mailbox.update { mailbox in
        mailbox.events.removeAll { $0.type == .recordStop || $0.type == .recordDiscard }
      }
    }
    let screens = NSScreen.screens.compactMap { AnnotateScreen($0) }
    guard let pointer = AnnotateGeometry.screen(under: NSEvent.mouseLocation, in: screens) else {
      machine.reset()
      flush()
      return .failure(AnnotateFailure(.noDisplay, "no display"))
    }
    let begin = CaptureBegin(
      screens: screens, pointer: pointer, front: AnnotateFront.read(),
      windows: CaptureWindowList.read())
    flush()
    return .success(begin)
  }

  /// A screenshot is done: back to idle.
  private func release() {
    selector?.finish(.cancelled)
    selector = nil
    machine.reset()
    flush()
  }

  /// A start that did not reach recording: every window goes.
  private func abortStart() {
    selector?.finish(.cancelled)
    selector = nil
    countdown?.finish(false)
    countdown = nil
    tearDownRecording()
    machine.reset()
    flush()
  }

  private func startTicking(_ current: CaptureRecording) {
    current.capsule.capsuleView.onAction = { [weak self] target in self?.capsuleAction(target) }
    let timer = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in self?.tick() }
    RunLoop.main.add(timer, forMode: .common)
    self.timer = timer
    tick()
  }

  private func beginFinishing(endedBy: String) -> Result<FinishStep, AnnotateFailure> {
    switch machine.phase {
    case .selecting, .countdown:
      return .failure(AnnotateFailure(.busy, "the recording has not started"))
    case .idle, .finishing:
      if let finish = pending.get() { return .success(.wait(finish)) }
      return .failure(AnnotateFailure(.notRecording, "nothing is recording"))
    case .recording:
      guard let finishing = finishing(endedBy: endedBy) else {
        return .failure(AnnotateFailure(.internal, "the recording has no recorder"))
      }
      let finish = CaptureFinish(url: finishing.recording.url)
      pending.set(finish)
      return .success(.run(finishing, finish))
    }
  }

  /// Recording to finishing: the windows go.
  private func finishing(endedBy: String) -> CaptureFinishing? {
    guard let current = recording, let recorder = current.recorder else { return nil }
    let durationMs = machine.elapsedMs(now: Self.now())
    guard machine.finishing() else { return nil }
    tearDownRecording()
    flush()
    return CaptureFinishing(
      recording: current, recorder: recorder, durationMs: durationMs, endedBy: endedBy)
  }

  /// The cap or a stream failure: finish on a worker; `record_stop`
  /// collects it.
  private func finishByItself(reason: String) {
    guard machine.phase == .recording, let finishing = finishing(endedBy: reason) else { return }
    let finish = CaptureFinish(url: finishing.recording.url)
    pending.set(finish)
    DispatchQueue.global(qos: .userInitiated).async {
      _ = self.runFinish(finishing, finish)
    }
  }

  /// Every window and timer of the recording goes.
  private func tearDownRecording() {
    timer?.invalidate()
    timer = nil
    if let current = recording {
      current.capsule.capsuleView.onAction = nil
      current.outline.orderOut(nil)
      current.capsule.orderOut(nil)
      current.outline.close()
      current.capsule.close()
    }
    recording = nil
  }

  private func capsuleAction(_ target: AnnotateCapsuleTarget) {
    guard let current = recording else { return }
    let action: AnnotateCapsuleAction
    switch target {
    case .pen: action = .pen
    case .stop: action = .stop
    case .discard: action = .discard
    case .confirmDiscard: action = .confirmDiscard
    case .keep: action = .keep
    }
    machine.capsule(action, now: Self.now())
    current.capsule.capsuleView.asking = machine.asking
    flush()
  }

  private func tick() {
    guard let current = recording, machine.phase == .recording else {
      // Nothing records: no window of a recording may stay.
      if machine.phase != .recording && machine.phase != .countdown { tearDownRecording() }
      return
    }
    let now = Self.now()
    for effect in machine.tick(now: now) {
      switch effect {
      case .questionClosed:
        current.capsule.capsuleView.asking = false
      case .cap:
        finishByItself(reason: "cap")
        return
      }
    }
    current.capsule.capsuleView.clock = AnnotateMachine.clock(ms: machine.elapsedMs(now: now))
    flush()
  }

  /// Publishes the machine's events and phase for the host's polls.
  private func flush() {
    let events = machine.drainEvents()
    let phase = machine.phase
    let startedAt = machine.startedAt
    mailbox.update { mailbox in
      mailbox.events.append(contentsOf: events)
      mailbox.phase = phase
      mailbox.startedAt = startedAt
    }
  }
}

/// Other apps' windows the selector can pick, from the window list.
enum CaptureWindowList {
  static let minSize = CGSize(width: 60, height: 40)

  /// Front to back: on screen, the normal level, at least 60 × 40 points.
  /// Titles show only with Screen Recording.
  static func read() -> [CaptureWindow] {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]]
    else {
      return []
    }
    let own = ProcessInfo.processInfo.processIdentifier
    return list.compactMap { info -> CaptureWindow? in
      guard let pid = (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value, pid != own,
        (info[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
        let number = (info[kCGWindowNumber as String] as? NSNumber)?.uint32Value,
        let bounds = info[kCGWindowBounds as String] as? NSDictionary,
        let frame = CGRect(dictionaryRepresentation: bounds as CFDictionary),
        frame.width >= minSize.width, frame.height >= minSize.height
      else {
        return nil
      }
      if let alpha = (info[kCGWindowAlpha as String] as? NSNumber)?.doubleValue, alpha <= 0 {
        return nil
      }
      let title = (info[kCGWindowName as String] as? String)?
        .trimmingCharacters(in: .whitespacesAndNewlines)
      return CaptureWindow(
        id: number, pid: pid, frame: frame, owner: info[kCGWindowOwnerName as String] as? String,
        title: title?.isEmpty == false ? title : nil)
    }
  }
}
