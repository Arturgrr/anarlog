import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useMemo, type ReactNode } from "react";

import { EditorLabelsProvider, type EditorLabels } from "@anlg/editor/labels";
import { UiLabelsProvider, type UiLabels } from "@anlg/ui/components/ui/labels";

// Shared packages render their own chrome; give them the app's translations.
export function ComponentLabelsProvider({ children }: { children: ReactNode }) {
  const { t } = useLingui();

  const uiLabels = useMemo<UiLabels>(
    () => ({
      close: t`Close`,
      previousSlide: t`Previous slide`,
      nextSlide: t`Next slide`,
      dismiss: t`Dismiss`,
      pause: t`Pause`,
      resume: t`Resume`,
      pauseAutoDismiss: t`Pause auto-dismiss`,
      resumeAutoDismiss: t`Resume auto-dismiss`,
      toastTimer: ({ seconds, paused, count }) =>
        paused ? (
          <Trans>
            Timer paused {count}{" "}
            <Plural value={seconds} one="second" other="seconds" />
          </Trans>
        ) : (
          <Trans>
            Closing in {count}{" "}
            <Plural value={seconds} one="second" other="seconds" />
          </Trans>
        ),
    }),
    [t],
  );

  const editorLabels = useMemo<EditorLabels>(
    () => ({
      commands: t`Commands`,
      slashCommands: {
        paragraph: t`Text`,
        heading1: t`Heading 1`,
        heading2: t`Heading 2`,
        heading3: t`Heading 3`,
        bulletList: t`Bullet List`,
        orderedList: t`Numbered List`,
        taskList: t`Task List`,
        blockquote: t`Quote`,
        codeBlock: t`Code Block`,
        horizontalRule: t`Divider`,
      },
      formatSelection: t`Format selection`,
      comment: t`Comment`,
      openFile: t`Open file`,
      removeAttachment: t`Remove attachment`,
      resizeImageFromLeft: t`Resize image from left`,
      resizeImageFromRight: t`Resize image from right`,
      editorFailed: t`The editor failed to render. Your recording is still running.`,
      reloadEditor: t`Reload editor`,
    }),
    [t],
  );

  return (
    <UiLabelsProvider labels={uiLabels}>
      <EditorLabelsProvider labels={editorLabels}>
        {children}
      </EditorLabelsProvider>
    </UiLabelsProvider>
  );
}
