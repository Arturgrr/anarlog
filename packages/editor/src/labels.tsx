import { createContext, useContext, type ReactNode } from "react";

// Built-in editor text. The app provides translated labels; English is the
// fallback for editors rendered without a provider.
export type EditorLabels = Readonly<{
  commands: string;
  slashCommands: Readonly<Record<string, string>>;
  formatSelection: string;
  comment: string;
  openFile: string;
  removeAttachment: string;
  resizeImageFromLeft: string;
  resizeImageFromRight: string;
  editorFailed: string;
  reloadEditor: string;
}>;

export const DEFAULT_EDITOR_LABELS: EditorLabels = {
  commands: "Commands",
  slashCommands: {},
  formatSelection: "Format selection",
  comment: "Comment",
  openFile: "Open file",
  removeAttachment: "Remove attachment",
  resizeImageFromLeft: "Resize image from left",
  resizeImageFromRight: "Resize image from right",
  editorFailed: "The editor failed to render. Your recording is still running.",
  reloadEditor: "Reload editor",
};

export const EditorLabelsContext = createContext<EditorLabels>(
  DEFAULT_EDITOR_LABELS,
);

export function EditorLabelsProvider({
  labels,
  children,
}: {
  labels: EditorLabels;
  children: ReactNode;
}) {
  return <EditorLabelsContext value={labels}>{children}</EditorLabelsContext>;
}

export function useEditorLabels(): EditorLabels {
  return useContext(EditorLabelsContext);
}
