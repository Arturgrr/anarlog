import {
  approximateMeasure,
  arrowHead,
  clampRect,
  type Handle,
  markBounds,
  markHandles,
  type Measure,
  normalizeRect,
  pixelBlock,
  rectHandles,
  smoothPoints,
  textFont,
  textLineHeight,
} from "./geometry";
import {
  type BoxMark,
  counterRadius,
  type Doc,
  HANDLE_PT,
  isBox,
  isSegment,
  isStroke,
  lineWidth,
  type Mark,
  type Point,
  type Rect,
  textPx,
} from "./model";

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type Source = HTMLImageElement | ImageBitmap;

const SELECTION = "#007aff";

export function sourceSize(source: Source) {
  if ("naturalWidth" in source) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

export function makeCanvas(width: number, height: number) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: OffscreenCanvas | HTMLCanvasElement) {
  return canvas.getContext("2d", { willReadFrequently: true }) as Ctx | null;
}

export function contrastColor(color: string) {
  const hex = color.replace("#", "");
  const [r, g, b] = [0, 2, 4].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.6 ? "#000000" : "#ffffff";
}

const tiles = new WeakMap<
  Source,
  Map<string, OffscreenCanvas | HTMLCanvasElement>
>();

function pixelTile(source: Source, rect: Rect, block: number) {
  const key = `${rect.x},${rect.y},${rect.width},${rect.height},${block}`;
  let cache = tiles.get(source);
  if (!cache) {
    cache = new Map();
    tiles.set(source, cache);
  }
  const cached = cache.get(key);
  if (cached) return cached;

  const sample = makeCanvas(rect.width, rect.height);
  const sampleCtx = context2d(sample);
  const cols = Math.ceil(rect.width / block);
  const rows = Math.ceil(rect.height / block);
  const tile = makeCanvas(cols, rows);
  const tileCtx = context2d(tile);
  if (!sampleCtx || !tileCtx) return null;
  sampleCtx.drawImage(
    source,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height,
  );
  const { data } = sampleCtx.getImageData(0, 0, rect.width, rect.height);
  const out = tileCtx.createImageData(cols, rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const sum = [0, 0, 0, 0];
      let count = 0;
      const yEnd = Math.min(rect.height, (row + 1) * block);
      const xEnd = Math.min(rect.width, (col + 1) * block);
      for (let y = row * block; y < yEnd; y += 1) {
        for (let x = col * block; x < xEnd; x += 1) {
          const i = (y * rect.width + x) * 4;
          sum[0] += data[i];
          sum[1] += data[i + 1];
          sum[2] += data[i + 2];
          sum[3] += data[i + 3];
          count += 1;
        }
      }
      const o = (row * cols + col) * 4;
      for (let c = 0; c < 4; c += 1) out.data[o + c] = sum[c] / count;
    }
  }
  tileCtx.putImageData(out, 0, 0);
  if (cache.size > 32) cache.delete(cache.keys().next().value as string);
  cache.set(key, tile);
  return tile;
}

function drawPixelate(ctx: Ctx, mark: BoxMark, source: Source) {
  const { width, height } = sourceSize(source);
  const rect = clampRect(normalizeRect(mark.from, mark.to), width, height);
  if (rect.width < 1 || rect.height < 1) return;
  const block = pixelBlock(rect);
  const tile = pixelTile(source, rect, block);
  if (!tile) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    tile,
    rect.x,
    rect.y,
    Math.ceil(rect.width / block) * block,
    Math.ceil(rect.height / block) * block,
  );
  ctx.restore();
}

function strokePath(ctx: Ctx, points: Point[]) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.stroke();
}

export function drawMark(ctx: Ctx, mark: Mark, scale: number, source: Source) {
  ctx.save();
  ctx.strokeStyle = mark.color;
  ctx.fillStyle = mark.color;
  ctx.lineWidth = lineWidth(mark, scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (isSegment(mark)) {
    strokePath(ctx, [mark.from, mark.to]);
    if (mark.kind === "arrow") {
      const [left, right] = arrowHead(mark.from, mark.to, ctx.lineWidth);
      strokePath(ctx, [left, mark.to, right]);
    }
  } else if (mark.kind === "pixelate") {
    drawPixelate(ctx, mark, source);
  } else if (isBox(mark)) {
    const rect = normalizeRect(mark.from, mark.to);
    ctx.beginPath();
    if (mark.kind === "rect") {
      ctx.rect(rect.x, rect.y, rect.width, rect.height);
    } else {
      ctx.ellipse(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
        rect.width / 2,
        rect.height / 2,
        0,
        0,
        Math.PI * 2,
      );
    }
    ctx.stroke();
  } else if (isStroke(mark)) {
    if (mark.kind === "highlighter") {
      ctx.globalAlpha = 0.4;
      ctx.globalCompositeOperation = "multiply";
      ctx.lineCap = "butt";
    }
    const points = smoothPoints(mark.points);
    if (points.length === 1) {
      const r = ctx.lineWidth / 2;
      ctx.beginPath();
      if (mark.kind === "highlighter") {
        ctx.rect(points[0].x - r, points[0].y - r, r * 2, r * 2);
      } else {
        ctx.arc(points[0].x, points[0].y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    } else {
      strokePath(ctx, points);
    }
  } else if (mark.kind === "text") {
    const px = textPx(mark.size, scale);
    const lineHeight = textLineHeight(px);
    ctx.font = textFont(px);
    ctx.textBaseline = "middle";
    ctx.strokeStyle = contrastColor(mark.color);
    ctx.lineWidth = Math.max(scale, px * 0.12);
    mark.text.split("\n").forEach((line, i) => {
      const y = mark.at.y + (i + 0.5) * lineHeight;
      ctx.strokeText(line, mark.at.x, y);
      ctx.fillText(line, mark.at.x, y);
    });
  } else {
    const r = counterRadius(mark.size, scale);
    const contrast = contrastColor(mark.color);
    ctx.beginPath();
    ctx.arc(mark.at.x, mark.at.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = contrast;
    ctx.lineWidth = Math.max(scale, r * 0.12);
    ctx.stroke();
    ctx.fillStyle = contrast;
    const label = String(mark.value);
    ctx.font = textFont(r * (label.length > 1 ? 0.95 : 1.15));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, mark.at.x, mark.at.y + r * 0.04);
  }
  ctx.restore();
}

export function drawScene(
  ctx: Ctx,
  doc: Doc,
  source: Source,
  hidden: string | null = null,
) {
  ctx.drawImage(source, 0, 0, doc.width, doc.height);
  for (const mark of doc.marks) {
    if (mark.id !== hidden) drawMark(ctx, mark, doc.scale, source);
  }
}

function drawHandles(ctx: Ctx, points: Point[], unit: number) {
  const size = HANDLE_PT * unit;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = SELECTION;
  ctx.lineWidth = unit * 1.25;
  for (const point of points) {
    ctx.beginPath();
    ctx.rect(point.x - size / 2, point.y - size / 2, size, size);
    ctx.fill();
    ctx.stroke();
  }
}

export function drawSelection(
  ctx: Ctx,
  mark: Mark,
  scale: number,
  unit: number,
  measure: Measure,
) {
  ctx.save();
  const handles = markHandles(mark);
  if (handles.length === 0 || mark.kind === "pixelate") {
    const bounds =
      mark.kind === "pixelate"
        ? normalizeRect(mark.from, mark.to)
        : markBounds(mark, scale, measure);
    ctx.strokeStyle = SELECTION;
    ctx.lineWidth = unit;
    ctx.setLineDash([unit * 4, unit * 3]);
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.setLineDash([]);
  }
  drawHandles(
    ctx,
    handles.map((handle) => handle.point),
    unit,
  );
  ctx.restore();
}

export function drawCropOverlay(
  ctx: Ctx,
  doc: Doc,
  crop: Rect | null,
  unit: number,
) {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.beginPath();
  ctx.rect(0, 0, doc.width, doc.height);
  if (crop) ctx.rect(crop.x, crop.y, crop.width, crop.height);
  ctx.fill("evenodd");
  if (crop) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = unit;
    ctx.strokeRect(crop.x, crop.y, crop.width, crop.height);
    drawHandles(
      ctx,
      rectHandles(crop, true).map((handle) => handle.point),
      unit,
    );
  }
  ctx.restore();
}

export const HANDLE_CURSORS: Record<Handle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  from: "crosshair",
  to: "crosshair",
};

let measureContext: Ctx | null | undefined;

export const canvasMeasure: Measure = (text, font) => {
  if (measureContext === undefined) {
    try {
      measureContext = makeCanvas(1, 1).getContext("2d") as Ctx | null;
    } catch {
      measureContext = null;
    }
  }
  if (!measureContext) return approximateMeasure(text, font);
  measureContext.font = font;
  return measureContext.measureText(text).width;
};
