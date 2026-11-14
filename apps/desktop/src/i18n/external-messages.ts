import { t } from "@lingui/core/macro";

// Native plugins and shared packages report English strings. Map the ones
// users see in normal use to catalog messages; anything unknown is shown as-is.
export function localizeExternalMessage(message: string): string {
  const text = message.trim();
  // Capture's shortcut registration names each shortcut that failed on a line.
  if (text.includes("\n")) {
    return text.split("\n").map(localizeExternalMessage).join("\n");
  }

  switch (text) {
    case "Enable Librelog in System Settings > Privacy & Security > Accessibility to insert dictation into other apps.":
      return t`Enable Librelog in System Settings > Privacy & Security > Accessibility to insert dictation into other apps.`;
    case "Dictation is unavailable in password fields and while Secure Keyboard Entry is on.":
      return t`Dictation is unavailable in password fields and while Secure Keyboard Entry is on.`;
    case "Dictation is unavailable in password fields and while Secure Keyboard Entry is on. Copy your last dictation from Settings > Dictation.":
      return t`Dictation is unavailable in password fields and while Secure Keyboard Entry is on. Copy your last dictation from Settings > Dictation.`;
    case "Focus an editable text field in an application with accessibility enabled. Password fields are excluded.":
      return t`Focus an editable text field in an application with accessibility enabled. Password fields are excluded.`;
    case "Focus an editable text field before dictating.":
      return t`Focus an editable text field before dictating.`;
    case "Finding the focused field timed out. Enable accessibility in the target app.":
      return t`Finding the focused field timed out. Enable accessibility in the target app.`;
    case "The focused text field changed. Copy your last dictation from Settings > Dictation.":
    case "The focused field changed. Copy your last dictation from Settings > Dictation.":
      return t`The focused text field changed. Copy your last dictation from Settings > Dictation.`;
    case "Could not insert text. Copy your last dictation from Settings > Dictation.":
    case "This app could not insert text. Copy your last dictation from Settings > Dictation.":
      return t`Could not insert text. Copy your last dictation from Settings > Dictation.`;
    case "Could not preserve the clipboard. Copy your last dictation from Settings > Dictation.":
      return t`Could not preserve the clipboard. Copy your last dictation from Settings > Dictation.`;
    case "Could not prepare dictation for insertion.":
      return t`Could not prepare dictation for insertion.`;
    case "Clear the text selection before dictating, or copy your last dictation to replace it.":
      return t`Clear the text selection before dictating, or copy your last dictation to replace it.`;
    case "Dictation is unavailable in password fields.":
      return t`Dictation is unavailable in password fields.`;
    case "This field does not expose whether it is editable. Copy your last dictation from Settings > Dictation.":
      return t`This field does not expose whether it is editable. Copy your last dictation from Settings > Dictation.`;
    case "This text field does not expose an accessibility identity.":
      return t`This text field does not expose an accessibility identity.`;
    case "Release the shortcut keys before inserting text. Copy your last dictation from Settings > Dictation.":
      return t`Release the shortcut keys before inserting text. Copy your last dictation from Settings > Dictation.`;
    case "Windows could not insert the entire dictation. Check the field before copying your last dictation. Elevated apps may block text insertion.":
      return t`Windows could not insert the entire dictation. Check the field before copying your last dictation. Elevated apps may block text insertion.`;
    case "voice recording is already active":
      return t`Voice recording is already active.`;
    case "voice recording is not active":
    case "unknown voice recording":
      return t`Voice recording is not active.`;
    case "not supported on this platform":
      return t`Not supported on this platform.`;
    case "Global shortcuts are unavailable in this desktop session.":
      return t`Global shortcuts are unavailable in this desktop session.`;
    case "Choose a shortcut with Control, Alt, Shift, or Command.":
      return t`Choose a shortcut with Control, Alt, Shift, or Command.`;
    case "Double-tap shortcuts are only available on macOS.":
      return t`Double-tap shortcuts are only available on macOS.`;
    case "Escape is reserved for cancelling dictation. Choose another key.":
      return t`Escape is reserved for cancelling dictation. Choose another key.`;
    case "This shortcut already starts dictation. Choose another one.":
      return t`This shortcut already starts dictation. Choose another one.`;
    case "This shortcut already pastes the last dictation. Choose another one.":
      return t`This shortcut already pastes the last dictation. Choose another one.`;
    case "This shortcut is already used by Annotate. Choose another one.":
      return t`This shortcut is already used by Annotate. Choose another one.`;
    case "This shortcut is already used by another Librelog shortcut. Choose another one.":
      return t`This shortcut is already used by another Librelog shortcut. Choose another one.`;
    case "Annotate is only available in the macOS app.":
      return t`Annotate is only available in the macOS app.`;
    case "Screen Recording is not allowed for Librelog.":
      return t`Screen Recording is not allowed for Librelog.`;
    case "Capture is only available in the macOS app.":
      return t`Screenshots and recordings are only available in the macOS app.`;
    case "A capture is already running.":
      return t`A screenshot or recording is already in progress.`;
    case "No recording is running.":
      return t`No recording is running.`;
    case "This capture is no longer in the list.":
      return t`This capture is no longer in the list.`;
    case "Only screenshots can be edited.":
      return t`Only screenshots can be edited.`;
    case "The destination must be an absolute file path.":
      return t`Choose a folder and a file name to save to.`;
    case "Replacing the macOS screenshot shortcuts is only available on macOS.":
      return t`Replacing the macOS screenshot shortcuts is only available on macOS.`;
    case "This shortcut is already used by Screenshots. Choose another one.":
      return t`This shortcut is already used by Screenshots. Choose another one.`;
    case "An annotation is already starting.":
    case "An annotation is already recording.":
    case "An annotation is already finishing.":
      return t`An annotation is already in progress.`;
    case "No annotation is recording.":
      return t`No annotation is recording.`;
    case "This annotation is no longer waiting to be finished.":
      return t`This annotation is no longer waiting to be finished.`;
    case "Transcription stopped.":
      return t`Transcription stopped.`;
    case "Batch transcription did not include the current recording.":
      return t`Batch transcription did not include the current recording.`;
    case "The new transcription returned much less text. Your saved transcript and recording were kept. Try transcribing again.":
      return t`The new transcription returned much less text. Your saved transcript and recording were kept. Try transcribing again.`;
    case "No speech was detected in the audio.":
      return t`No speech was detected in the audio.`;
    case "Local transcription is busy with another recording. Try again when it finishes.":
      return t`Local transcription is busy with another recording. Try again when it finishes.`;
    case "The AI model is overloaded right now. Wait a moment, then retry.":
      return t`The AI model is overloaded right now. Wait a moment, then retry.`;
    case "Images must be 8 MB or smaller.":
      return t`Images must be 8 MB or smaller.`;
    case "This image would make the chat draft too large. Remove another image and try again.":
      return t`This image would make the chat draft too large. Remove another image and try again.`;
  }

  const detail = (prefix: string) =>
    text.startsWith(prefix) ? text.slice(prefix.length) : null;

  let rest = detail("microphone capture failed: ");
  if (rest !== null) return t`Microphone capture failed: ${rest}`;
  rest = detail("voice recording failed: ");
  if (rest !== null) return t`Voice recording failed: ${rest}`;
  rest = detail("voice recording task failed: ");
  if (rest !== null) return t`Voice recording failed: ${rest}`;
  rest = detail(
    "Could not register dictation shortcut. It may be used by another app: ",
  );
  if (rest !== null)
    return t`Could not register dictation shortcut. It may be used by another app: ${rest}`;
  rest = detail(
    "Could not register the paste last dictation shortcut. It may be used by another app: ",
  );
  if (rest !== null)
    return t`Could not register the paste last dictation shortcut. It may be used by another app: ${rest}`;
  rest = detail("Could not capture the screen: ");
  if (rest !== null) return t`Could not capture the screen: ${rest}`;
  rest = detail("Could not write the capture: ");
  if (rest !== null) return t`Could not write the capture: ${rest}`;
  rest = detail("The edited picture is not a usable PNG: ");
  if (rest !== null) return t`The edited picture is not a usable PNG: ${rest}`;
  rest = detail("Could not change the macOS screenshot shortcuts: ");
  if (rest !== null)
    return t`Could not change the macOS screenshot shortcuts: ${rest}`;
  for (const [name, label] of [
    ["capture area", t`Capture area`],
    ["capture full screen", t`Capture full screen`],
    ["capture window", t`Capture window`],
    ["record video", t`Record screen`],
    ["record GIF", t`Record GIF`],
  ]) {
    rest = detail(`Could not register the ${name} shortcut. `);
    if (rest === null) continue;
    const reason = localizeExternalMessage(rest);
    return t`Could not register the ${label} shortcut. ${reason}`;
  }
  rest = detail("Invalid dictation shortcut: ");
  if (rest !== null) return t`Invalid dictation shortcut: ${rest}`;
  rest = detail("dictation indicator failed: ");
  if (rest !== null)
    return t`Could not show the dictation indicator. Please try again.`;

  return message;
}

// The native transcript renderer labels unnamed voices in English.
export function localizeSpeakerLabel(label: string): string {
  if (label === "You") return t`You`;

  const speakerNumber = /^Speaker (\d+)$/.exec(label)?.[1];
  if (speakerNumber) return t`Speaker ${speakerNumber}`;

  return label;
}

// Permission guidance names a System Settings pane in English.
export function localizeSettingsPane(title: string | null | undefined): string {
  if (title === "Accessibility") return t`Accessibility`;
  return title ?? t`Privacy`;
}
