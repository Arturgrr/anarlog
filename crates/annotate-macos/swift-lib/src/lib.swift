// The C entry points `crates/annotate-macos/src/lib.rs` declares. Each
// answers with the JSON envelope `AnnotateReply` writes and never traps.
// The blocking ones refuse the main thread, whose run loop the windows and
// ScreenCaptureKit's waits need.

import AppKit
import Foundation
import SwiftRs

private func reply(_ work: () -> String) -> SRString {
  autoreleasepool { SRString(work()) }
}

private func blocking(_ work: () -> String) -> SRString {
  reply {
    guard !Thread.isMainThread else {
      return AnnotateReply.failure(
        AnnotateFailure(.mainThread, "call this from a worker thread, not the main thread"))
    }
    return work()
  }
}

@_cdecl("_annotate_probe")
public func annotateProbe() -> SRString {
  blocking { AnnotateReply.ok(AnnotatePermissions.probe()) }
}

@_cdecl("_annotate_request")
public func annotateRequest() -> SRString {
  reply { AnnotateReply.ok(AnnotatePermissions.request()) }
}

@_cdecl("_annotate_open_settings")
public func annotateOpenSettings() -> SRString {
  reply {
    let opened = annotateOnMain { () -> Bool in
      AnnotatePermissions.settingsURLs.contains { link in
        guard let url = URL(string: link) else { return false }
        return NSWorkspace.shared.open(url)
      }
    }
    guard opened else {
      return AnnotateReply.failure(AnnotateFailure(.io, "could not open System Settings"))
    }
    return AnnotateReply.ok(AnnotateNothing())
  }
}

@_cdecl("_annotate_start")
public func annotateStart(request: SRString) -> SRString {
  let json = request.toString()
  return blocking {
    AnnotateReply.from(
      AnnotateReply.decode(AnnotateStartRequest.self, from: json).flatMap {
        AnnotateSession.shared.start($0)
      })
  }
}

@_cdecl("_annotate_stop")
public func annotateStop() -> SRString {
  blocking { AnnotateReply.from(AnnotateSession.shared.stop()) }
}

@_cdecl("_annotate_cancel")
public func annotateCancel() -> SRString {
  blocking { AnnotateReply.from(AnnotateSession.shared.cancel()) }
}

@_cdecl("_annotate_set_ink_mode")
public func annotateSetInkMode(mode: SRString) -> SRString {
  let name = mode.toString()
  return reply {
    guard let mode = AnnotateInkMode(rawValue: name) else {
      return AnnotateReply.failure(
        AnnotateFailure(.invalidArgument, "ink mode must be off, hover or drag, not \(name)"))
    }
    return AnnotateReply.from(AnnotateSession.shared.setInk(mode))
  }
}

@_cdecl("_annotate_poll_events")
public func annotatePollEvents() -> SRString {
  reply { AnnotateReply.ok(AnnotateSession.shared.drainEvents()) }
}

@_cdecl("_annotate_status")
public func annotateStatus() -> SRString {
  reply { AnnotateReply.ok(AnnotateSession.shared.status()) }
}

@_cdecl("_annotate_extract_frames")
public func annotateExtractFrames(request: SRString) -> SRString {
  let json = request.toString()
  return blocking {
    AnnotateReply.from(
      AnnotateReply.decode(AnnotateExtractRequest.self, from: json).flatMap {
        AnnotateFrames.extract($0)
      })
  }
}
