import { useLingui } from "@lingui/react/macro";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { Minus, Plus } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { TooltipProvider } from "@anlg/ui/components/ui/tooltip";
import { cn } from "@anlg/utils";

import { EditorCanvas } from "./canvas";
import { type Source } from "./draw";
import { shortcut, Tip, Toolbar } from "./toolbar";
import { type Editor, useEditor } from "./use-editor";

export { flatten, imageFromBlob, loadImage } from "./flatten";

export function CaptureEditor(props: {
  image: Source;
  scale: number;
  onCopy: (png: Blob) => Promise<void>;
  onSave: (png: Blob) => Promise<void>;
  onSaveAs: (png: Blob) => Promise<void>;
  onClose: () => void;
}) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <EditorShell {...props} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function EditorShell(props: Parameters<typeof useEditor>[0]) {
  const editor = useEditor(props);
  return (
    <div className="bg-background text-foreground flex h-full min-h-0 w-full flex-col select-none">
      <Toolbar editor={editor} />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <EditorCanvas editor={editor} />
        <Status editor={editor} />
        {editor.confirmClose && <ConfirmClose editor={editor} />}
        {editor.cropping && <CropBar editor={editor} />}
        <Zoom editor={editor} />
      </div>
    </div>
  );
}

const floating = cn([
  "bg-popover text-popover-foreground border-border absolute flex items-center gap-1 rounded-lg border p-1 shadow-md",
]);

function Status({ editor }: { editor: Editor }) {
  const { t } = useLingui();
  const { action } = editor;
  const message = action.isSuccess
    ? action.variables === "copy"
      ? t`Copied`
      : t`Saved`
    : action.isError
      ? action.error.message || t`Something went wrong`
      : null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute top-3 right-3"
    >
      {message && (
        <div
          title={message}
          className={cn([
            "max-w-80 truncate rounded-md px-2.5 py-1 text-xs font-medium shadow-md",
            action.isError
              ? "bg-danger-bg text-danger"
              : "bg-contrast text-primary-foreground",
          ])}
        >
          {message}
        </div>
      )}
    </div>
  );
}

function ConfirmClose({ editor }: { editor: Editor }) {
  const { t } = useLingui();
  return (
    <div
      role="alertdialog"
      aria-label={t`Discard changes?`}
      className={cn([floating, "top-3 left-1/2 -translate-x-1/2 pl-3"])}
    >
      <span className="text-ui mr-2">{t`Discard changes?`}</span>
      <Button variant="destructive" size="sm" onClick={editor.discard}>
        {t`Discard`}
      </Button>
      <Button variant="ghost" size="sm" autoFocus onClick={editor.keepEditing}>
        {t`Keep editing`}
      </Button>
    </div>
  );
}

function CropBar({ editor }: { editor: Editor }) {
  const { t } = useLingui();
  return (
    <div className={cn([floating, "bottom-4 left-1/2 -translate-x-1/2"])}>
      {editor.hasCrop && (
        <Button variant="ghost" size="sm" onClick={editor.resetCrop}>
          {t`Reset crop`}
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={editor.cancelCrop}>
        {t`Cancel`}
      </Button>
      <Button size="sm" disabled={!editor.cropDraft} onClick={editor.applyCrop}>
        {t`Crop`}
      </Button>
    </div>
  );
}

function Zoom({ editor }: { editor: Editor }) {
  const { t } = useLingui();
  return (
    <div className={cn([floating, "right-3 bottom-4 gap-0"])}>
      <Tip label={t`Zoom out`} keys={shortcut("−")}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t`Zoom out`}
          onClick={editor.zoomOut}
        >
          <Minus className="size-3.5" />
        </Button>
      </Tip>
      <Tip label={t`Zoom to fit`} keys={shortcut("0")}>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-12 px-1 tabular-nums"
          onClick={editor.zoomFit}
        >
          {`${Math.round(editor.view.zoom * editor.doc.scale * 100)}%`}
        </Button>
      </Tip>
      <Tip label={t`Zoom in`} keys={shortcut("+")}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t`Zoom in`}
          onClick={editor.zoomIn}
        >
          <Plus className="size-3.5" />
        </Button>
      </Tip>
    </div>
  );
}
