// One recording at a time: the state machine, the recorder, the ink
// overlay and the capsule, and what the host reads back. The machine, the
// strokes and the windows live on the main thread; the host's calls come
// from its worker threads, hop to the main thread only for short steps,
// and do ScreenCaptureKit's waiting where they are. Events and the status
// sit behind a lock, so polling never waits on the main thread.

import AppKit
import Foundation
import ScreenCaptureKit

/// A recording being finished, or finished and not yet claimed.
final class AnnotateFinish {
  let dir: URL
  let reason: String
  private let group = DispatchGroup()
  private let outcome = AnnotateLocked<Result<AnnotateStopResult, AnnotateFailure>?>(nil)

  init(dir: URL, reason: String) {
    self.dir = dir
    self.reason = reason
    group.enter()
  }

  var isDone: Bool { outcome.get() != nil }

  func complete(_ result: Result<AnnotateStopResult, AnnotateFailure>) {
    guard outcome.get() == nil else { return }
    outcome.set(result)
    group.leave()
  }

  func wait(_ seconds: Double) -> Result<AnnotateStopResult, AnnotateFailure> {
    _ = group.wait(timeout: .now() + seconds)
    return outcome.get()
      ?? .failure(AnnotateFailure(.timeout, "the recording did not finish in time"))
  }
}

/// What a recording keeps from its start to its finish. Main thread.
private final class AnnotateCurrent {
  let screen: AnnotateScreen
  let dir: URL
  let front: AnnotateFrontApp
  let ink: AnnotateInkPanel
  let capsule: AnnotateCapsulePanel
  var recorder: AnnotateRecorder?
  var anchorTicks: UInt64 = 0
  var wallMs: Int64 = 0
  var display: AnnotateDisplayInfo?
  var strokes: AnnotateStrokeRecorder
  var lastMouse: CGPoint?
  var animating = true

  init(screen: AnnotateScreen, dir: URL, front: AnnotateFrontApp) {
    self.screen = screen
    self.dir = dir
    self.front = front
    ink = AnnotateInkPanel(screen: screen)
    capsule = AnnotateCapsulePanel(screen: screen)
    strokes = AnnotateStrokeRecorder(size: screen.frame.size)
  }
}

/// What a finishing recording hands its worker.
private struct AnnotateFinishing {
  var current: AnnotateCurrent
  var recorder: AnnotateRecorder
  var strokes: [AnnotateStroke]
  var stopTicks: UInt64
  var endedBy: String
}

final class AnnotateSession {
  static let shared = AnnotateSession()

  private struct Mailbox {
    var events: [AnnotateEvent] = []
    var status = AnnotateStatus.idle
  }

  private let mailbox = AnnotateLocked(Mailbox())
  private let pending = AnnotateLocked<AnnotateFinish?>(nil)

  // Main thread only.
  private var machine = AnnotateMachine()
  private var current: AnnotateCurrent?
  private var timer: Timer?
  private var monitors: [Any] = []

  private var timebase: AnnotateTimebase { AnnotateHostClock.timebase }

  // MARK: Any thread

  func status() -> AnnotateStatus {
    var status = mailbox.get().status
    status.resultPending = pending.get()?.isDone ?? false
    return status
  }

  func drainEvents() -> [AnnotateEvent] {
    mailbox.update { mailbox in
      defer { mailbox.events.removeAll() }
      return mailbox.events
    }
  }

  func setInk(_ mode: AnnotateInkMode) -> Result<AnnotateNothing, AnnotateFailure> {
    guard mailbox.get().status.phase == .recording else {
      return .failure(AnnotateFailure(.notRecording, "nothing is recording"))
    }
    DispatchQueue.main.async { self.applyHostInk(mode) }
    return .success(AnnotateNothing())
  }

  // MARK: Worker threads

  func start(_ request: AnnotateStartRequest) -> Result<AnnotateStartReply, AnnotateFailure> {
    guard request.dir.hasPrefix("/") else {
      return .failure(AnnotateFailure(.invalidArgument, "dir must be an absolute path"))
    }
    let dir = URL(fileURLWithPath: request.dir, isDirectory: true)
    let current: AnnotateCurrent
    switch annotateOnMain({ reserve(dir: dir) }) {
    case .success(let reserved): current = reserved
    case .failure(let failure): return .failure(failure)
    }
    var created: [URL] = []
    let result = prepareAndStart(current, created: &created)
    if case .failure = result {
      annotateOnMain { abortStart(current) }
      remove(created)
    }
    return result
  }

  func stop() -> Result<AnnotateStopResult, AnnotateFailure> {
    switch annotateOnMain({ beginFinishing(reason: "stop") }) {
    case .failure(let failure):
      return .failure(failure)
    case .success(let step):
      let result: Result<AnnotateStopResult, AnnotateFailure>
      switch step {
      case .run(let finishing, let finish):
        result = runFinish(finishing, finish)
      case .wait(let finish):
        result = finish.wait(AnnotateRecorder.finishTimeout * 2)
      }
      claim()
      return result
    }
  }

  /// Stops and deletes. Idempotent: nothing to cancel is fine.
  func cancel() -> Result<AnnotateNothing, AnnotateFailure> {
    switch annotateOnMain({ beginFinishing(reason: "cancel") }) {
    case .failure(let failure):
      if failure.code == .notRecording { return .success(AnnotateNothing()) }
      return .failure(failure)
    case .success(let step):
      let finish: AnnotateFinish
      switch step {
      case .run(let finishing, let started):
        _ = runFinish(finishing, started)
        finish = started
      case .wait(let waiting):
        _ = waiting.wait(AnnotateRecorder.finishTimeout * 2)
        finish = waiting
      }
      claim()
      remove([
        finish.dir.appendingPathComponent(AnnotateFiles.video),
        finish.dir.appendingPathComponent(AnnotateFiles.candidates),
      ])
      return .success(AnnotateNothing())
    }
  }

  private func prepareAndStart(_ current: AnnotateCurrent, created: inout [URL]) -> Result<
    AnnotateStartReply, AnnotateFailure
  > {
    let files = FileManager.default
    let video = current.dir.appendingPathComponent(AnnotateFiles.video)
    let candidates = current.dir.appendingPathComponent(AnnotateFiles.candidates)
    if files.fileExists(atPath: video.path) {
      return .failure(AnnotateFailure(.invalidArgument, "\(video.path) already exists"))
    }
    do {
      try files.createDirectory(at: current.dir, withIntermediateDirectories: true)
      if !files.fileExists(atPath: candidates.path) {
        try files.createDirectory(at: candidates, withIntermediateDirectories: true)
        created.append(candidates)
      }
    } catch {
      return .failure(AnnotateFailure(.io, "could not create \(current.dir.path): \(error)"))
    }
    created.append(video)

    let content: SCShareableContent
    switch Self.shareableContent() {
    case .success(let value): content = value
    case .failure(let failure): return .failure(failure)
    }
    guard let display = content.displays.first(where: { $0.displayID == current.screen.id })
    else {
      return .failure(AnnotateFailure(.noDisplay, "the display under the pointer is gone"))
    }
    let ownWindows = annotateOnMain {
      Set([current.ink.windowNumber, current.capsule.windowNumber])
    }
    let pid = ProcessInfo.processInfo.processIdentifier
    // This app's chrome (panels, HUDs: anything above the normal level) and
    // the two panels; its normal windows are recorded like any app's.
    let excluded = content.windows.filter { window in
      window.owningApplication?.processID == pid
        && (window.windowLayer != 0 || ownWindows.contains(Int(window.windowID)))
    }
    let filter = SCContentFilter(display: display, excludingWindows: excluded)
    let screen = current.screen
    guard
      let video = AnnotateGeometry.pixelSize(
        points: screen.frame.size, scale: screen.scale, longEdge: AnnotateRecorder.videoLongEdge),
      let candidate = AnnotateGeometry.pixelSize(
        points: screen.frame.size, scale: screen.scale,
        longEdge: AnnotateRecorder.candidateLongEdge)
    else {
      return .failure(AnnotateFailure(.noDisplay, "the display has no size"))
    }

    let recorder = AnnotateRecorder()
    recorder.onFailure = { message in
      DispatchQueue.main.async { self.finishByItself(reason: "stream_error", message: message) }
    }
    let anchor = AnnotateHostClock.now()
    let wallMs = Int64((Date().timeIntervalSince1970 * 1000).rounded())
    let plan = AnnotateRecordingPlan(
      filter: filter, videoSize: video, candidateSize: candidate, dir: current.dir,
      anchorTicks: anchor)
    if let failure = recorder.start(plan) {
      return .failure(failure)
    }
    let info = AnnotateDisplayInfo(
      id: screen.id, widthPt: Double(screen.frame.width), heightPt: Double(screen.frame.height),
      scale: Double(screen.scale),
      widthPx: Int((screen.frame.width * screen.scale).rounded()),
      heightPx: Int((screen.frame.height * screen.scale).rounded()), videoWidth: video.width,
      videoHeight: video.height)
    let running = annotateOnMain { () -> Bool in
      current.recorder = recorder
      current.anchorTicks = anchor
      current.wallMs = wallMs
      current.display = info
      return began(current)
    }
    guard running else {
      // Cancelled between the reservation and the stream starting.
      _ = recorder.stop()
      return .failure(AnnotateFailure(.busy, "the recording was cancelled while starting"))
    }
    return .success(
      AnnotateStartReply(
        startedHostTicks: anchor, startedHostNs: timebase.nanoseconds(anchor),
        startedWallMs: wallMs, display: info))
  }

  private static func shareableContent() -> Result<SCShareableContent, AnnotateFailure> {
    let reply = AnnotateLocked<(content: SCShareableContent?, error: Error?)?>(nil)
    let done = DispatchSemaphore(value: 0)
    SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: false) {
      content, error in
      reply.set((content, error))
      done.signal()
    }
    guard done.wait(timeout: .now() + AnnotateRecorder.startTimeout) == .success,
      let answer = reply.get()
    else {
      return .failure(AnnotateFailure(.timeout, "ScreenCaptureKit did not list the displays"))
    }
    if let content = answer.content { return .success(content) }
    if !CGPreflightScreenCaptureAccess() {
      return .failure(AnnotateFailure(.permission, "Screen Recording is not allowed"))
    }
    return .failure(AnnotateRecorder.failure(answer.error, "could not list the displays"))
  }

  /// Builds the result from the recorder's outcome; marks the session
  /// idle. On the calling worker.
  private func runFinish(_ finishing: AnnotateFinishing, _ finish: AnnotateFinish) -> Result<
    AnnotateStopResult, AnnotateFailure
  > {
    let outcome = finishing.recorder.stop()
    let current = finishing.current
    let result: Result<AnnotateStopResult, AnnotateFailure>
    if let failure = outcome.failure {
      result = .failure(failure)
    } else if let display = current.display {
      let offset = outcome.firstFrameTicks.map {
        timebase.milliseconds(from: current.anchorTicks, to: $0)
      }
      result = .success(
        AnnotateStopResult(
          videoPath: current.dir.appendingPathComponent(AnnotateFiles.video).path,
          startedHostTicks: current.anchorTicks,
          startedHostNs: timebase.nanoseconds(current.anchorTicks),
          startedWallMs: current.wallMs,
          durationMs: timebase.milliseconds(from: current.anchorTicks, to: finishing.stopTicks),
          videoOffsetMs: offset, videoDurationMs: outcome.videoDurationMs, display: display,
          frontApp: current.front, candidates: outcome.candidates, strokes: finishing.strokes,
          endedBy: finishing.endedBy, warnings: outcome.warnings))
    } else {
      result = .failure(AnnotateFailure(.internal, "the recording has no display"))
    }
    annotateOnMain {
      finish.complete(result)
      machine.reset()
      if finishing.endedBy != "stop" && finishing.endedBy != "cancel" {
        machine.stoppedByItself(reason: finishing.endedBy, message: outcome.failure?.message)
      }
      flush()
    }
    return result
  }

  /// The host has the finished recording: nothing pending, and no
  /// `stopped` event left to tell of it.
  private func claim() {
    pending.set(nil)
    mailbox.update { mailbox in mailbox.events.removeAll { $0.type == .stopped } }
  }

  /// Removes what a recording wrote; the directory itself is the host's.
  private func remove(_ urls: [URL]) {
    for url in urls { try? FileManager.default.removeItem(at: url) }
  }

  // MARK: Main thread

  private enum FinishStep {
    case run(AnnotateFinishing, AnnotateFinish)
    case wait(AnnotateFinish)
  }

  private func reserve(dir: URL) -> Result<AnnotateCurrent, AnnotateFailure> {
    if machine.phase == .idle, pending.get()?.isDone == true {
      // An unclaimed result of a recording that ended by itself; its files
      // stay where they are.
      claim()
    }
    guard machine.reserve() else {
      return .failure(AnnotateFailure(.busy, "a recording is \(machine.phase.rawValue)"))
    }
    let screens = NSScreen.screens.compactMap { AnnotateScreen($0) }
    guard let screen = AnnotateGeometry.screen(under: NSEvent.mouseLocation, in: screens) else {
      machine.reset()
      flush()
      return .failure(AnnotateFailure(.noDisplay, "no display"))
    }
    let current = AnnotateCurrent(screen: screen, dir: dir, front: AnnotateFront.read())
    // On screen before the filter is built, so it can leave them out.
    current.ink.orderFrontRegardless()
    current.capsule.orderFrontRegardless()
    self.current = current
    flush()
    return .success(current)
  }

  private func abortStart(_ current: AnnotateCurrent) {
    guard self.current === current else { return }
    tearDown()
    machine.reset()
    flush()
  }

  /// The stream runs: the clock starts and ink can be drawn. False when
  /// this start was given up meanwhile.
  private func began(_ current: AnnotateCurrent) -> Bool {
    guard self.current === current, machine.phase == .starting else { return false }
    let now = timebase.seconds(current.anchorTicks)
    machine.started(now: now)
    current.ink.inkView.onMouse = { [weak self] kind, point in self?.mouse(kind, point) }
    current.capsule.capsuleView.onAction = { [weak self] target in self?.capsuleAction(target) }
    // Escape reaches a global monitor only while the app may monitor keys
    // (Accessibility); the local one covers the app's own windows.
    let onEscape: (NSEvent) -> Void = { [weak self] event in
      if event.keyCode == 53 { self?.escape() }
    }
    if let monitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown, handler: onEscape) {
      monitors.append(monitor)
    }
    let local = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
      guard event.keyCode == 53, let self, self.machine.ink != .off else { return event }
      self.escape()
      return nil
    }
    if let local { monitors.append(local) }
    let timer = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in self?.tick() }
    RunLoop.main.add(timer, forMode: .common)
    self.timer = timer
    tick()
    return true
  }

  private func beginFinishing(reason: String) -> Result<FinishStep, AnnotateFailure> {
    switch machine.phase {
    case .starting:
      return .failure(AnnotateFailure(.busy, "the recording is still starting"))
    case .idle, .finishing:
      if let finish = pending.get() { return .success(.wait(finish)) }
      return .failure(AnnotateFailure(.notRecording, "nothing is recording"))
    case .recording:
      guard let finishing = finishing(endedBy: reason) else {
        return .failure(AnnotateFailure(.internal, "the recording has no recorder"))
      }
      let finish = AnnotateFinish(dir: finishing.current.dir, reason: reason)
      pending.set(finish)
      return .success(.run(finishing, finish))
    }
  }

  /// Recording to finishing: the last stroke ends, the windows go.
  private func finishing(endedBy: String) -> AnnotateFinishing? {
    guard let current, let recorder = current.recorder, machine.finishing() else { return nil }
    let stopTicks = AnnotateHostClock.now()
    current.strokes.end(tMs: timebase.milliseconds(from: current.anchorTicks, to: stopTicks))
    let finishing = AnnotateFinishing(
      current: current, recorder: recorder, strokes: current.strokes.strokes,
      stopTicks: stopTicks, endedBy: endedBy)
    tearDown()
    flush()
    return finishing
  }

  /// The cap or a stream failure: finish on a worker; `stop` collects it.
  private func finishByItself(reason: String, message: String? = nil) {
    guard machine.phase == .recording, let finishing = finishing(endedBy: reason) else { return }
    let finish = AnnotateFinish(dir: finishing.current.dir, reason: reason)
    pending.set(finish)
    DispatchQueue.global(qos: .userInitiated).async {
      _ = self.runFinish(finishing, finish)
    }
  }

  /// Every window and timer of the recording goes. Every way out of a
  /// recording comes through here.
  private func tearDown() {
    timer?.invalidate()
    timer = nil
    for monitor in monitors { NSEvent.removeMonitor(monitor) }
    monitors.removeAll()
    if let current {
      current.ink.inkView.onMouse = nil
      current.capsule.capsuleView.onAction = nil
      current.ink.takesPointer(false)
      current.ink.orderOut(nil)
      current.capsule.orderOut(nil)
      current.ink.close()
      current.capsule.close()
    }
    current = nil
  }

  private func nowTicks() -> (ticks: UInt64, seconds: Double) {
    let ticks = AnnotateHostClock.now()
    return (ticks, timebase.seconds(ticks))
  }

  private func tMs(_ current: AnnotateCurrent, _ ticks: UInt64) -> Int {
    timebase.milliseconds(from: current.anchorTicks, to: ticks)
  }

  private func applyHostInk(_ mode: AnnotateInkMode) {
    let now = nowTicks()
    guard machine.setInk(mode, now: now.seconds) else { return }
    inkChanged(at: now.ticks)
    flush()
  }

  private func escape() {
    guard machine.escape() else { return }
    inkChanged(at: AnnotateHostClock.now())
    flush()
  }

  /// Follows the machine's ink mode: the live stroke ends, the overlay
  /// takes or releases the pointer, and hover starts at the pointer.
  private func inkChanged(at ticks: UInt64) {
    guard let current else { return }
    let t = tMs(current, ticks)
    current.strokes.end(tMs: t)
    current.ink.takesPointer(machine.ink != .off)
    current.capsule.capsuleView.penOn = machine.ink == .drag
    if machine.ink == .hover { hover(NSEvent.mouseLocation, current, t) }
    current.animating = true
  }

  private func hover(_ mouse: CGPoint, _ current: AnnotateCurrent, _ t: Int) {
    guard AnnotateGeometry.contains(mouse, current.screen) else {
      current.strokes.end(tMs: t)
      return
    }
    let point = AnnotateGeometry.local(mouse, on: current.screen)
    if current.strokes.live == nil {
      current.strokes.begin(.hover, at: point, tMs: t)
    } else {
      current.strokes.add(point, tMs: t)
    }
  }

  private func mouse(_ kind: AnnotateMouse, _ point: CGPoint) {
    guard let current, machine.phase == .recording else { return }
    let now = nowTicks()
    machine.pointerMoved(now: now.seconds)
    guard machine.ink == .drag else { return }
    let t = tMs(current, now.ticks)
    switch kind {
    case .down: current.strokes.begin(.drag, at: point, tMs: t)
    case .dragged: current.strokes.add(point, tMs: t)
    case .up:
      current.strokes.add(point, tMs: t)
      current.strokes.end(tMs: t)
    }
    current.animating = true
  }

  private func capsuleAction(_ target: AnnotateCapsuleTarget) {
    guard current != nil else { return }
    let now = nowTicks()
    let action: AnnotateCapsuleAction
    switch target {
    case .pen: action = .pen
    case .stop: action = .stop
    case .discard: action = .discard
    case .confirmDiscard: action = .confirmDiscard
    case .keep: action = .keep
    }
    let ink = machine.ink
    machine.capsule(action, now: now.seconds)
    if machine.ink != ink { inkChanged(at: now.ticks) }
    current?.capsule.capsuleView.asking = machine.asking
    flush()
  }

  private func tick() {
    guard let current, machine.phase == .recording else {
      // Nothing records: no window of a recording may stay.
      if timer != nil && machine.phase != .recording { tearDown() }
      return
    }
    let now = nowTicks()
    let t = tMs(current, now.ticks)
    let mouse = NSEvent.mouseLocation
    if mouse != current.lastMouse {
      current.lastMouse = mouse
      machine.pointerMoved(now: now.seconds)
      if machine.ink == .hover {
        hover(mouse, current, t)
        current.animating = true
      }
    }
    for effect in machine.tick(now: now.seconds) {
      switch effect {
      case .inkOff:
        inkChanged(at: now.ticks)
      case .questionClosed:
        current.capsule.capsuleView.asking = false
      case .maxDuration:
        finishByItself(reason: "max_duration")
        return
      }
    }
    let animating = AnnotateInkLook.animating(current.strokes, nowMs: t)
    if animating || current.animating {
      current.ink.inkView.scene = AnnotateInkScene(
        strokes: AnnotateInkLook.visible(current.strokes, nowMs: t).map { shown in
          (shown.stroke.points.map { CGPoint(x: $0.x, y: $0.y) }, shown.alpha)
        },
        glow: AnnotateInkLook.glow(ms: Double(t)))
      current.ink.inkView.needsDisplay = true
    }
    current.animating = animating
    let elapsed = machine.elapsedMs(now: now.seconds)
    current.capsule.capsuleView.clock = AnnotateMachine.clock(ms: elapsed)
    flush()
  }

  /// Publishes the machine's events and status for the host's polls.
  private func flush() {
    let events = machine.drainEvents()
    let status = AnnotateStatus(
      phase: machine.phase, elapsedMs: machine.elapsedMs(now: nowTicks().seconds), ink: machine.ink,
      resultPending: false)
    mailbox.update { mailbox in
      mailbox.events.append(contentsOf: events)
      mailbox.status = status
    }
  }
}
