import { useLingui } from "@lingui/react/macro";
import { type ReactNode } from "react";

import {
  Copy,
  Cursor,
  DownloadSimple,
  FloppyDisk,
  Highlighter,
  Pencil,
  Square,
  TextT,
} from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@anlg/ui/components/ui/tooltip";
import { cn } from "@anlg/utils";

import {
  ArrowIcon,
  CounterIcon,
  CropIcon,
  EllipseIcon,
  LineIcon,
  PixelateIcon,
  RedoIcon,
  UndoIcon,
} from "./icons";
import { COLORS, type Size, type Tool } from "./model";
import { type Editor } from "./use-editor";

const MOD =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘"
    : "Ctrl+";

export function shortcut(keys: string, shift = false) {
  return `${shift ? "⇧" : ""}${MOD}${keys}`;
}

export function Tip({
  label,
  keys,
  children,
}: {
  label: string;
  keys?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {keys && <span className="ml-1.5 opacity-60">{keys}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

function Divider() {
  return <div className="bg-border mx-1.5 h-5 w-px shrink-0" />;
}

const keepFocus = (event: { preventDefault: () => void }) =>
  event.preventDefault();

export function Toolbar({ editor }: { editor: Editor }) {
  const { t } = useLingui();
  const icon = "size-4";
  const tools: { tool: Tool; label: string; keys: string; icon: ReactNode }[] =
    [
      {
        tool: "select",
        label: t`Select`,
        keys: "V",
        icon: <Cursor className={icon} />,
      },
      {
        tool: "arrow",
        label: t`Arrow`,
        keys: "A",
        icon: <ArrowIcon className={icon} />,
      },
      {
        tool: "line",
        label: t`Line`,
        keys: "L",
        icon: <LineIcon className={icon} />,
      },
      {
        tool: "rect",
        label: t`Rectangle`,
        keys: "R",
        icon: <Square className={icon} />,
      },
      {
        tool: "ellipse",
        label: t`Ellipse`,
        keys: "O",
        icon: <EllipseIcon className={icon} />,
      },
      {
        tool: "pen",
        label: t`Pen`,
        keys: "P",
        icon: <Pencil className={icon} />,
      },
      {
        tool: "highlighter",
        label: t`Highlighter`,
        keys: "H",
        icon: <Highlighter className={icon} />,
      },
      {
        tool: "text",
        label: t`Text`,
        keys: "T",
        icon: <TextT className={icon} />,
      },
      {
        tool: "pixelate",
        label: t`Pixelate`,
        keys: "X",
        icon: <PixelateIcon className={icon} />,
      },
      {
        tool: "counter",
        label: t`Counter`,
        keys: "N",
        icon: <CounterIcon className={icon} />,
      },
      {
        tool: "crop",
        label: t`Crop`,
        keys: "C",
        icon: <CropIcon className={icon} />,
      },
    ];
  const colorLabels = [
    t`Red`,
    t`Orange`,
    t`Yellow`,
    t`Green`,
    t`Blue`,
    t`White`,
    t`Black`,
  ];
  const sizes: { size: Size; label: string; dot: number }[] = [
    { size: "s", label: t`Small`, dot: 4 },
    { size: "m", label: t`Medium`, dot: 7 },
    { size: "l", label: t`Large`, dot: 10 },
  ];
  const pending = editor.action.isPending;

  return (
    <div
      role="toolbar"
      aria-label={t`Screenshot editor`}
      className={cn([
        "@container flex h-11 shrink-0 items-center gap-0.5 px-2",
        "border-border bg-layer-1 text-foreground border-b",
      ])}
    >
      <div className="flex items-center gap-0.5">
        {tools.map(({ tool, label, keys, icon: glyph }) => (
          <Tip key={tool} label={label} keys={keys}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={label}
              aria-pressed={editor.tool === tool}
              onClick={() => editor.setTool(tool)}
              className={cn([
                "text-icon",
                editor.tool === tool && "text-foreground before:bg-pressed",
              ])}
            >
              {glyph}
            </Button>
          </Tip>
        ))}
      </div>
      <Divider />
      <div className="flex items-center" role="group" aria-label={t`Color`}>
        {COLORS.map((color, i) => (
          <Tip key={color} label={colorLabels[i]}>
            <button
              type="button"
              aria-label={colorLabels[i]}
              aria-pressed={editor.style.color === color}
              onMouseDown={keepFocus}
              onClick={() => editor.setColor(color)}
              className={cn([
                "flex size-6 cursor-pointer items-center justify-center rounded-full",
                "focus-visible:outline-ring focus-visible:outline-2",
              ])}
            >
              <span
                className={cn([
                  "size-4 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.18)]",
                  editor.style.color === color &&
                    "ring-foreground ring-offset-layer-1 ring-2 ring-offset-1",
                ])}
                style={{ backgroundColor: color }}
              />
            </button>
          </Tip>
        ))}
      </div>
      <Divider />
      <div
        className="flex items-center gap-0.5"
        role="group"
        aria-label={t`Size`}
      >
        {sizes.map(({ size, label, dot }) => (
          <Tip key={size} label={label}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={label}
              aria-pressed={editor.style.size === size}
              onMouseDown={keepFocus}
              onClick={() => editor.setSize(size)}
              className={cn([
                editor.style.size === size && "before:bg-pressed",
              ])}
            >
              <span
                className="bg-foreground rounded-full"
                style={{ width: dot, height: dot }}
              />
            </Button>
          </Tip>
        ))}
      </div>
      <Divider />
      <Tip label={t`Undo`} keys={shortcut("Z")}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t`Undo`}
          disabled={!editor.canUndo}
          onClick={editor.undo}
        >
          <UndoIcon className="size-4" />
        </Button>
      </Tip>
      <Tip label={t`Redo`} keys={shortcut("Z", true)}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t`Redo`}
          disabled={!editor.canRedo}
          onClick={editor.redo}
        >
          <RedoIcon className="size-4" />
        </Button>
      </Tip>
      <div className="min-w-2 flex-1" />
      <div className="flex items-center gap-1">
        <Tip label={t`Copy`} keys={shortcut("C")}>
          <Button
            variant="ghost"
            className="px-2"
            aria-label={t`Copy`}
            disabled={pending}
            onClick={() => editor.run("copy")}
          >
            <Copy className="size-4" />
            <span className="hidden @[1000px]:inline">{t`Copy`}</span>
          </Button>
        </Tip>
        <Tip label={t`Save As…`} keys={shortcut("S", true)}>
          <Button
            variant="ghost"
            className="px-2"
            aria-label={t`Save As…`}
            disabled={pending}
            onClick={() => editor.run("saveAs")}
          >
            <DownloadSimple className="size-4" />
            <span className="hidden @[1000px]:inline">{t`Save As…`}</span>
          </Button>
        </Tip>
        <Tip label={t`Save`} keys={shortcut("S")}>
          <Button disabled={pending} onClick={() => editor.run("save")}>
            <FloppyDisk className="size-4" />
            {t`Save`}
          </Button>
        </Tip>
      </div>
    </div>
  );
}
