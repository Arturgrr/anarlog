export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Size = "s" | "m" | "l";
export type Style = { color: string; size: Size };

export type Tool =
  | "select"
  | "arrow"
  | "line"
  | "rect"
  | "ellipse"
  | "pen"
  | "highlighter"
  | "text"
  | "pixelate"
  | "counter"
  | "crop";

type Base = { id: string; color: string; size: Size };
export type SegmentMark = Base & {
  kind: "arrow" | "line";
  from: Point;
  to: Point;
};
export type BoxMark = Base & {
  kind: "rect" | "ellipse" | "pixelate";
  from: Point;
  to: Point;
};
export type StrokeMark = Base & {
  kind: "pen" | "highlighter";
  points: Point[];
};
export type TextMark = Base & { kind: "text"; at: Point; text: string };
export type CounterMark = Base & { kind: "counter"; at: Point; value: number };
export type Mark = SegmentMark | BoxMark | StrokeMark | TextMark | CounterMark;

export type Doc = {
  width: number;
  height: number;
  scale: number;
  marks: Mark[];
  crop: Rect | null;
};

export const COLORS = [
  "#ff3b30",
  "#ff9500",
  "#ffcc00",
  "#34c759",
  "#007aff",
  "#ffffff",
  "#000000",
] as const;
export const SIZES: Size[] = ["s", "m", "l"];
export const DEFAULT_STYLE: Style = { color: COLORS[0], size: "m" };

const STROKE_PT = { s: 2, m: 4, l: 7 };
const TEXT_PT = { s: 16, m: 22, l: 32 };
const COUNTER_PT = { s: 11, m: 14, l: 19 };
const HIGHLIGHTER_FACTOR = 5;

export const MIN_DRAG_PT = 4;
export const HIT_SLOP_PT = 6;
export const HANDLE_PT = 8;

export function lineWidth(mark: Pick<Mark, "kind" | "size">, scale: number) {
  const width = STROKE_PT[mark.size] * scale;
  return mark.kind === "highlighter" ? width * HIGHLIGHTER_FACTOR : width;
}

export function textPx(size: Size, scale: number) {
  return TEXT_PT[size] * scale;
}

export function counterRadius(size: Size, scale: number) {
  return COUNTER_PT[size] * scale;
}

export function isSegment(mark: Mark): mark is SegmentMark {
  return mark.kind === "arrow" || mark.kind === "line";
}

export function isBox(mark: Mark): mark is BoxMark {
  return (
    mark.kind === "rect" || mark.kind === "ellipse" || mark.kind === "pixelate"
  );
}

export function isStroke(mark: Mark): mark is StrokeMark {
  return mark.kind === "pen" || mark.kind === "highlighter";
}

let nextId = 0;
export function markId() {
  nextId += 1;
  return `m${nextId}`;
}

export function createDoc(width: number, height: number, scale: number): Doc {
  return { width, height, scale, marks: [], crop: null };
}

export function addMark(doc: Doc, mark: Mark): Doc {
  return { ...doc, marks: [...doc.marks, mark] };
}

export function replaceMark(doc: Doc, mark: Mark): Doc {
  return {
    ...doc,
    marks: doc.marks.map((current) =>
      current.id === mark.id ? mark : current,
    ),
  };
}

export function removeMark(doc: Doc, id: string): Doc {
  if (!doc.marks.some((mark) => mark.id === id)) return doc;
  return { ...doc, marks: doc.marks.filter((mark) => mark.id !== id) };
}

export function findMark(doc: Doc, id: string | null) {
  return id === null ? undefined : doc.marks.find((mark) => mark.id === id);
}

export function setCrop(doc: Doc, crop: Rect | null): Doc {
  if (crop === doc.crop) return doc;
  if (
    crop &&
    doc.crop &&
    crop.x === doc.crop.x &&
    crop.y === doc.crop.y &&
    crop.width === doc.crop.width &&
    crop.height === doc.crop.height
  ) {
    return doc;
  }
  return { ...doc, crop };
}

export function nextCounterValue(doc: Doc) {
  return (
    doc.marks.reduce(
      (max, mark) =>
        mark.kind === "counter" ? Math.max(max, mark.value) : max,
      0,
    ) + 1
  );
}

export function translateMark<T extends Mark>(
  mark: T,
  dx: number,
  dy: number,
): T {
  const shift = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
  if (isSegment(mark) || isBox(mark)) {
    return { ...mark, from: shift(mark.from), to: shift(mark.to) };
  }
  if (isStroke(mark)) return { ...mark, points: mark.points.map(shift) };
  return { ...mark, at: shift(mark.at) };
}

export function moveMark(doc: Doc, id: string, dx: number, dy: number): Doc {
  const mark = findMark(doc, id);
  if (!mark || (dx === 0 && dy === 0)) return doc;
  return replaceMark(doc, translateMark(mark, dx, dy));
}

export function restyleMark(doc: Doc, id: string, style: Partial<Style>): Doc {
  const mark = findMark(doc, id);
  if (!mark) return doc;
  const next = { ...mark, ...style };
  if (next.color === mark.color && next.size === mark.size) return doc;
  return replaceMark(doc, next);
}

export function markIsBigEnough(mark: Mark, scale: number) {
  const min = MIN_DRAG_PT * scale;
  if (isSegment(mark)) {
    return Math.hypot(mark.to.x - mark.from.x, mark.to.y - mark.from.y) >= min;
  }
  if (isBox(mark)) {
    return (
      Math.abs(mark.to.x - mark.from.x) >= min &&
      Math.abs(mark.to.y - mark.from.y) >= min
    );
  }
  if (isStroke(mark)) return mark.points.length > 0;
  if (mark.kind === "text") return mark.text.trim() !== "";
  return true;
}

export type TextEdit = {
  id: string | null;
  at: Point;
  text: string;
  color: string;
  size: Size;
};

export function commitText(doc: Doc, edit: TextEdit): Doc {
  const empty = edit.text.trim() === "";
  const existing = findMark(doc, edit.id);
  if (existing?.kind === "text") {
    if (empty) return removeMark(doc, existing.id);
    if (
      existing.text === edit.text &&
      existing.color === edit.color &&
      existing.size === edit.size
    ) {
      return doc;
    }
    return replaceMark(doc, {
      ...existing,
      text: edit.text,
      color: edit.color,
      size: edit.size,
    });
  }
  if (empty) return doc;
  return addMark(doc, {
    id: edit.id ?? markId(),
    kind: "text",
    at: edit.at,
    text: edit.text,
    color: edit.color,
    size: edit.size,
  });
}
