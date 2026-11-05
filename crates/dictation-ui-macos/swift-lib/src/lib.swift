import Foundation
import SwiftRs

private func hudOnMain<T>(_ work: () -> T) -> T {
  Thread.isMainThread ? work() : DispatchQueue.main.sync(execute: work)
}

@_cdecl("_dictation_hud_prewarm")
public func _dictationHudPrewarm() {
  DispatchQueue.main.async { DictationHud.shared.prewarm() }
}

/// Handles one HUD event on the main thread; a `started` returns once the
/// HUD is on screen, or false when it can't show.
@_cdecl("_dictation_hud_event")
public func _dictationHudEvent(json: SRString) -> Bool {
  guard let data = json.toString().data(using: .utf8),
    let event = try? JSONDecoder().decode(HudEvent.self, from: data)
  else {
    return false
  }
  return hudOnMain { DictationHud.shared.handle(event) }
}

@_cdecl("_dictation_hud_meter")
public func _dictationHudMeter(rms: Double) {
  DispatchQueue.main.async { DictationHud.shared.meter(rms: Float(rms)) }
}
