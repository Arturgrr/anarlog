import {
  type BoxMark,
  counterRadius,
  type Doc,
  isBox,
  isSegment,
  isStroke,
  lineWidth,
  type Mark,
  type Point,
  type Rect,
  type SegmentMark,
  textPx,
  type TextMark,
} from "./model";

export type Measure = (text: string, font: string) => number;
export type Handle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "from"
  | "to";

const HEAD_ANGLE = 0.5;
const HEAD_LENGTH = 4;
const LINE_HEIGHT = 1.2;
const MIN_CROP_PT = 8;

export const approximateMeasure: Measure = (text, font) => {
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  return text.length * px * 0.6;
};

export function arrowHead(
  from: Point,
  to: Point,
  width: number,
): [Point, Point] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(Math.hypot(dx, dy), Number.EPSILON);
  const head = Math.min(HEAD_LENGTH * width, length * 0.5);
  const ux = dx / length;
  const uy = dy / length;
  const side = (turn: number): Point => {
    const sin = Math.sin(turn);
    const cos = Math.cos(turn);
    return {
      x: to.x + (-ux * cos + uy * sin) * head,
      y: to.y + (-ux * sin - uy * cos) * head,
    };
  };
  return [side(HEAD_ANGLE), side(-HEAD_ANGLE)];
}

export function constrainAngle(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const length = Math.hypot(dx, dy);
  const x = Math.cos(angle) * length;
  const y = Math.sin(angle) * length;
  return {
    x: from.x + (Math.abs(x) < 1e-9 ? 0 : x),
    y: from.y + (Math.abs(y) < 1e-9 ? 0 : y),
  };
}

export function constrainSquare(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: from.x + (dx < 0 ? -side : side),
    y: from.y + (dy < 0 ? -side : side),
  };
}

export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function inflate(rect: Rect, by: number): Rect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + by * 2,
    height: rect.height + by * 2,
  };
}

export function contains(rect: Rect, p: Point) {
  return (
    p.x >= rect.x &&
    p.y >= rect.y &&
    p.x <= rect.x + rect.width &&
    p.y <= rect.y + rect.height
  );
}

export function intersects(a: Rect, b: Rect) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

export function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq),
        );
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function smoothPoints(points: Point[], iterations = 2): Point[] {
  let current = points;
  for (let i = 0; i < iterations && current.length > 2; i += 1) {
    const next: Point[] = [current[0]];
    for (let j = 0; j < current.length - 1; j += 1) {
      const a = current[j];
      const b = current[j + 1];
      next.push(
        { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 },
        { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 },
      );
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

export function textFont(px: number) {
  return `700 ${px}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
}

export function textLineHeight(px: number) {
  return px * LINE_HEIGHT;
}

export function textBounds(
  mark: TextMark,
  scale: number,
  measure: Measure,
): Rect {
  const px = textPx(mark.size, scale);
  const font = textFont(px);
  const lines = mark.text.split("\n");
  const width = Math.max(px * 0.3, ...lines.map((line) => measure(line, font)));
  return {
    x: mark.at.x,
    y: mark.at.y,
    width,
    height: lines.length * textLineHeight(px),
  };
}

export function markBounds(mark: Mark, scale: number, measure: Measure): Rect {
  if (isSegment(mark)) {
    const pad =
      mark.kind === "arrow" ? lineWidth(mark, scale) * HEAD_LENGTH : 0;
    return inflate(
      normalizeRect(mark.from, mark.to),
      pad + lineWidth(mark, scale),
    );
  }
  if (isBox(mark)) {
    const pad = mark.kind === "pixelate" ? 0 : lineWidth(mark, scale);
    return inflate(normalizeRect(mark.from, mark.to), pad);
  }
  if (isStroke(mark)) {
    const xs = mark.points.map((p) => p.x);
    const ys = mark.points.map((p) => p.y);
    return inflate(
      normalizeRect(
        { x: Math.min(...xs), y: Math.min(...ys) },
        { x: Math.max(...xs), y: Math.max(...ys) },
      ),
      lineWidth(mark, scale),
    );
  }
  if (mark.kind === "text")
    return inflate(textBounds(mark, scale, measure), scale * 2);
  const r = counterRadius(mark.size, scale);
  return { x: mark.at.x - r, y: mark.at.y - r, width: r * 2, height: r * 2 };
}

function distanceToEllipse(p: Point, rect: Rect) {
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  const dx = p.x - (rect.x + rx);
  const dy = p.y - (rect.y + ry);
  if (rx === 0 || ry === 0) {
    return distanceToSegment(
      p,
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
    );
  }
  const k = Math.hypot(dx / rx, dy / ry);
  const r = Math.hypot(dx, dy);
  if (k === 0) return Math.min(rx, ry);
  return Math.abs(r - r / k);
}

export function hitMark(
  mark: Mark,
  p: Point,
  slop: number,
  scale: number,
  measure: Measure,
) {
  const reach = lineWidth(mark, scale) / 2 + slop;
  if (isSegment(mark)) {
    if (distanceToSegment(p, mark.from, mark.to) <= reach) return true;
    if (mark.kind !== "arrow") return false;
    return arrowHead(mark.from, mark.to, lineWidth(mark, scale)).some(
      (side) => distanceToSegment(p, mark.to, side) <= reach,
    );
  }
  if (isBox(mark)) {
    const rect = normalizeRect(mark.from, mark.to);
    if (mark.kind === "pixelate") return contains(inflate(rect, slop), p);
    if (mark.kind === "ellipse") return distanceToEllipse(p, rect) <= reach;
    const { x, y, width, height } = rect;
    const corners = [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ];
    return corners.some(
      (corner, i) =>
        distanceToSegment(p, corner, corners[(i + 1) % 4]) <= reach,
    );
  }
  if (isStroke(mark)) {
    if (mark.points.length === 1) {
      return (
        Math.hypot(p.x - mark.points[0].x, p.y - mark.points[0].y) <= reach
      );
    }
    return mark.points.some(
      (point, i) =>
        i > 0 && distanceToSegment(p, mark.points[i - 1], point) <= reach,
    );
  }
  if (mark.kind === "text") {
    return contains(inflate(textBounds(mark, scale, measure), slop), p);
  }
  return (
    Math.hypot(p.x - mark.at.x, p.y - mark.at.y) <=
    counterRadius(mark.size, scale) + slop
  );
}

export function hitTest(
  doc: Doc,
  p: Point,
  slop: number,
  measure: Measure = approximateMeasure,
) {
  for (let i = doc.marks.length - 1; i >= 0; i -= 1) {
    if (hitMark(doc.marks[i], p, slop, doc.scale, measure))
      return doc.marks[i].id;
  }
  return null;
}

export function rectHandles(
  rect: Rect,
  edges = false,
): { handle: Handle; point: Point }[] {
  const { x, y, width, height } = rect;
  const corners: { handle: Handle; point: Point }[] = [
    { handle: "nw", point: { x, y } },
    { handle: "ne", point: { x: x + width, y } },
    { handle: "se", point: { x: x + width, y: y + height } },
    { handle: "sw", point: { x, y: y + height } },
  ];
  if (!edges) return corners;
  return [
    ...corners,
    { handle: "n", point: { x: x + width / 2, y } },
    { handle: "e", point: { x: x + width, y: y + height / 2 } },
    { handle: "s", point: { x: x + width / 2, y: y + height } },
    { handle: "w", point: { x, y: y + height / 2 } },
  ];
}

export function markHandles(mark: Mark): { handle: Handle; point: Point }[] {
  if (isSegment(mark)) {
    return [
      { handle: "from", point: mark.from },
      { handle: "to", point: mark.to },
    ];
  }
  if (isBox(mark)) return rectHandles(normalizeRect(mark.from, mark.to));
  return [];
}

export function handleAt(
  handles: { handle: Handle; point: Point }[],
  p: Point,
  radius: number,
) {
  for (let i = handles.length - 1; i >= 0; i -= 1) {
    const { handle, point } = handles[i];
    if (
      Math.abs(p.x - point.x) <= radius &&
      Math.abs(p.y - point.y) <= radius
    ) {
      return handle;
    }
  }
  return null;
}

export function resizeRect(rect: Rect, handle: Handle, p: Point): Rect {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;
  if (handle.includes("w")) left = p.x;
  if (handle.includes("e")) right = p.x;
  if (handle.includes("n")) top = p.y;
  if (handle.includes("s")) bottom = p.y;
  return normalizeRect({ x: left, y: top }, { x: right, y: bottom });
}

export function resizeMark<T extends Mark>(
  mark: T,
  handle: Handle,
  p: Point,
  constrain: boolean,
): T {
  if (isSegment(mark)) {
    const segment: SegmentMark = mark;
    if (handle === "from") {
      return { ...mark, from: constrain ? constrainAngle(segment.to, p) : p };
    }
    if (handle === "to") {
      return { ...mark, to: constrain ? constrainAngle(segment.from, p) : p };
    }
    return mark;
  }
  if (isBox(mark)) {
    const box: BoxMark = mark;
    const rect = normalizeRect(box.from, box.to);
    const opposite = {
      x: handle.includes("w") ? rect.x + rect.width : rect.x,
      y: handle.includes("n") ? rect.y + rect.height : rect.y,
    };
    return {
      ...mark,
      from: opposite,
      to: constrain ? constrainSquare(opposite, p) : p,
    };
  }
  return mark;
}

export function clampRect(rect: Rect, width: number, height: number): Rect {
  const x0 = Math.round(Math.max(0, Math.min(width, rect.x)));
  const y0 = Math.round(Math.max(0, Math.min(height, rect.y)));
  const x1 = Math.round(Math.max(0, Math.min(width, rect.x + rect.width)));
  const y1 = Math.round(Math.max(0, Math.min(height, rect.y + rect.height)));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function cropIsBigEnough(rect: Rect, scale: number) {
  const min = MIN_CROP_PT * scale;
  return rect.width >= min && rect.height >= min;
}

export function moveRectWithin(
  rect: Rect,
  dx: number,
  dy: number,
  width: number,
  height: number,
): Rect {
  return {
    ...rect,
    x: Math.round(Math.max(0, Math.min(width - rect.width, rect.x + dx))),
    y: Math.round(Math.max(0, Math.min(height - rect.height, rect.y + dy))),
  };
}

export function pixelBlock(rect: Rect) {
  return Math.max(8, Math.round(Math.min(rect.width, rect.height) / 12));
}

export function exportRect(doc: Doc): Rect {
  return doc.crop ?? { x: 0, y: 0, width: doc.width, height: doc.height };
}

export function marksInRect(
  doc: Doc,
  rect: Rect,
  measure: Measure = approximateMeasure,
) {
  return doc.marks.filter((mark) =>
    intersects(markBounds(mark, doc.scale, measure), rect),
  );
}
