import { useLingui } from "@lingui/react/macro";
import { useEffect, useLayoutEffect, useRef } from "react";

import { cn } from "@anlg/utils";

import {
  canvasMeasure,
  contrastColor,
  type Ctx,
  drawCropOverlay,
  drawScene,
  drawSelection,
} from "./draw";
import { textFont, textLineHeight } from "./geometry";
import { textPx } from "./model";
import { type Editor } from "./use-editor";

export function EditorCanvas({ editor }: { editor: Editor }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wheel = useRef(editor.onWheel);
  wheel.current = editor.onWheel;
  const { setStage } = editor;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () =>
      setStage({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [setStage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const listener = (event: WheelEvent) =>
      wheel.current(event, canvas.getBoundingClientRect());
    canvas.addEventListener("wheel", listener, { passive: false });
    return () => canvas.removeEventListener("wheel", listener);
  }, []);

  const {
    doc,
    view,
    unit,
    stage,
    image,
    selected,
    cropping,
    cropDraft,
    textEdit,
  } = editor;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d") as Ctx | null | undefined;
    if (!canvas || !ctx || stage.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(stage.width * dpr);
    const height = Math.round(stage.height * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(
      dpr * view.zoom,
      0,
      0,
      dpr * view.zoom,
      dpr * view.x,
      dpr * view.y,
    );
    const visible =
      !cropping && doc.crop
        ? doc.crop
        : { x: 0, y: 0, width: doc.width, height: doc.height };
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
    ctx.shadowBlur = 12 * dpr;
    ctx.shadowOffsetY = 2 * dpr;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(visible.x, visible.y, visible.width, visible.height);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(visible.x, visible.y, visible.width, visible.height);
    ctx.clip();
    ctx.imageSmoothingQuality = "high";
    drawScene(ctx, doc, image, textEdit?.id ?? null);
    ctx.restore();
    if (selected && !textEdit) {
      drawSelection(ctx, selected, doc.scale, unit, canvasMeasure);
    }
    if (cropping) drawCropOverlay(ctx, doc, cropDraft, unit);
  }, [doc, view, unit, stage, image, selected, cropping, cropDraft, textEdit]);

  return (
    <div
      ref={containerRef}
      className={cn(["bg-layer-2 relative min-h-0 flex-1 overflow-hidden"])}
    >
      <canvas
        ref={canvasRef}
        data-testid="capture-canvas"
        className="absolute inset-0 size-full touch-none"
        style={{ cursor: editor.cursor }}
        onPointerDown={editor.onPointerDown}
        onPointerMove={editor.onPointerMove}
        onPointerUp={editor.onPointerUp}
        onPointerCancel={editor.onPointerCancel}
        onDoubleClick={editor.onDoubleClick}
        onContextMenu={(event) => event.preventDefault()}
      />
      {textEdit && <TextOverlay editor={editor} />}
    </div>
  );
}

function TextOverlay({ editor }: { editor: Editor }) {
  const { t } = useLingui();
  const { textEdit, view, doc } = editor;
  if (!textEdit) return null;
  const px = textPx(textEdit.size, doc.scale) * view.zoom;
  const lineHeight = textLineHeight(px);
  const font = textFont(px);
  const lines = textEdit.text.split("\n");
  const width =
    Math.max(...lines.map((line) => canvasMeasure(line, font))) + px;
  const outline =
    Math.max(doc.scale, textPx(textEdit.size, doc.scale) * 0.12) * view.zoom;

  return (
    <textarea
      autoFocus
      spellCheck={false}
      aria-label={t`Text`}
      value={textEdit.text}
      onChange={(event) => editor.updateText(event.target.value)}
      onKeyDown={editor.onTextKeyDown}
      onBlur={editor.commitTextEdit}
      wrap="off"
      className={cn([
        "absolute resize-none overflow-hidden border-0 bg-transparent p-0 whitespace-pre",
        "outline-1 outline-offset-4 outline-[#007aff] outline-dashed",
      ])}
      style={{
        left: view.x + textEdit.at.x * view.zoom,
        top: view.y + textEdit.at.y * view.zoom,
        width,
        height: lines.length * lineHeight,
        font,
        lineHeight: `${lineHeight}px`,
        color: textEdit.color,
        caretColor: textEdit.color,
        WebkitTextStroke: `${outline}px ${contrastColor(textEdit.color)}`,
        paintOrder: "stroke fill",
      }}
    />
  );
}
