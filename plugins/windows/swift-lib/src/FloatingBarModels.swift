import Foundation

enum FloatingBarStatus: String, Codable, Equatable {
  case recording
  case reconnecting
  case error
}

enum FloatingBarColorScheme: String, Codable, Equatable {
  case light
  case dark
}

struct FloatingTranscriptBubblePayload: Codable, Identifiable, Equatable {
  let id: String
  let speakerLabel: String
  let text: String
  let isSelf: Bool
  let isFinal: Bool
  let startMs: Double
  let endMs: Double
  let overlapsPrevious: Bool
  let overlapsNext: Bool
}

// Sent by the frontend in the app language; English until the first update.
struct FloatingBarLabels: Codable, Equatable {
  var stop = "Stop"
  var stopListening = "Stop listening"
  var reconnectingStopListening = "Reconnecting live transcription; stop listening"
  var errorStopListening = "Recording needs attention; stop listening"
  var errorHelp = "Recording needs attention. Open Librelog to retry or change devices."
  var collapseTranscript = "Collapse live transcript"
  var expandTranscript = "Expand live transcript"
  var goToBottom = "Go to bottom"
  var scrollTranscriptToBottom = "Scroll transcript to bottom"
  var overlappingSpeech = "Overlapping speech"
  var settingsTitle = "Floating bar"
  var closeSettings = "Close settings"
  var barOpacity = "Bar opacity"
  var showTranscript = "Show transcript"
  var hideTranscript = "Hide transcript"
}

struct FloatingBarStatePayload: Codable {
  let amplitude: Double
  let title: String
  let status: FloatingBarStatus
  let colorScheme: FloatingBarColorScheme
  let opacity: Double
  let liveCaptionOpacity: Double
  let liveCaptionWidth: Double
  let liveCaptionLineCount: Int
  let liveCaptionPosition: LiveCaptionPosition
  let liveCaptionMinimized: Bool
  let liveCaptionToggleVisible: Bool
  let transcriptBubbles: [FloatingTranscriptBubblePayload]?
  var transcriptNotice: String? = nil
  var labels: FloatingBarLabels? = nil
}
