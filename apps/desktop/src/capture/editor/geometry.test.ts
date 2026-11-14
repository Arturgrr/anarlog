import { describe, expect, it } from "vitest";

import {
  arrowHead,
  constrainAngle,
  constrainSquare,
  exportRect,
  hitTest,
  marksInRect,
  normalizeRect,
  pixelBlock,
  resizeMark,
} from "./geometry";
import { addMark, createDoc, type Mark, setCrop } from "./model";

const style = { color: "#ff3b30", size: "m" as const };

describe("arrowHead", () => {
  it("opens 0.5 rad either side of the shaft, 4 line widths long", () => {
    const [left, right] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
    expect(left.x).toBeCloseTo(100 - 16 * Math.cos(0.5));
    expect(right.x).toBeCloseTo(100 - 16 * Math.cos(0.5));
    expect(Math.abs(left.y)).toBeCloseTo(16 * Math.sin(0.5));
    expect(left.y).toBeCloseTo(-right.y);
  });

  it("caps the head at half a short arrow", () => {
    const [left] = arrowHead({ x: 0, y: 0 }, { x: 20, y: 0 }, 4);
    expect(Math.hypot(left.x - 20, left.y)).toBeCloseTo(10);
  });
});

describe("shift constraints", () => {
  it("snaps lines to 45° steps and keeps their length", () => {
    const flat = constrainAngle({ x: 0, y: 0 }, { x: 100, y: 30 });
    expect(flat.y).toBe(0);
    expect(flat.x).toBeCloseTo(Math.hypot(100, 30));
    const diagonal = constrainAngle({ x: 0, y: 0 }, { x: 100, y: 90 });
    expect(diagonal.x).toBeCloseTo(diagonal.y);
  });

  it("makes boxes square in the drag's direction", () => {
    expect(constrainSquare({ x: 10, y: 10 }, { x: 60, y: -10 })).toEqual({
      x: 60,
      y: -40,
    });
  });
});

describe("hitTest", () => {
  const rect = (id: string, x: number): Mark => ({
    id,
    kind: "rect",
    from: { x, y: 0 },
    to: { x: x + 100, y: 100 },
    ...style,
  });
  const doc = [rect("below", 0), rect("above", 0)].reduce(
    addMark,
    createDoc(500, 500, 2),
  );

  it("picks the top-most mark under the pointer", () => {
    expect(hitTest(doc, { x: 0, y: 50 }, 12)).toBe("above");
  });

  it("reaches marks within the slop but not beyond it", () => {
    expect(hitTest(doc, { x: -14, y: 50 }, 12)).toBe("above");
    expect(hitTest(doc, { x: -30, y: 50 }, 12)).toBeNull();
    expect(hitTest(doc, { x: 50, y: 50 }, 12)).toBeNull();
  });
});

describe("resizeMark", () => {
  it("moves a box corner and keeps the opposite one", () => {
    const box: Mark = {
      id: "b",
      kind: "pixelate",
      from: { x: 10, y: 10 },
      to: { x: 110, y: 60 },
      ...style,
    };
    const resized = resizeMark(box, "nw", { x: 0, y: 30 }, false);
    expect(normalizeRect(resized.from, resized.to)).toEqual({
      x: 0,
      y: 30,
      width: 110,
      height: 30,
    });
  });

  it("moves one end of a line, constrained with Shift", () => {
    const line: Mark = {
      id: "l",
      kind: "arrow",
      from: { x: 0, y: 0 },
      to: { x: 50, y: 0 },
      ...style,
    };
    const resized = resizeMark(line, "to", { x: 100, y: 10 }, true);
    expect(resized.from).toEqual({ x: 0, y: 0 });
    expect(resized.to.y).toBe(0);
    expect(resized.to.x).toBeCloseTo(Math.hypot(100, 10));
  });
});

describe("pixelBlock", () => {
  it("is a twelfth of the shorter side, never under 8 px", () => {
    expect(pixelBlock({ x: 0, y: 0, width: 60, height: 40 })).toBe(8);
    expect(pixelBlock({ x: 0, y: 0, width: 600, height: 240 })).toBe(20);
  });
});

describe("crop", () => {
  it("exports the crop's size and leaves marks outside it out", () => {
    const inside: Mark = {
      id: "in",
      kind: "counter",
      at: { x: 120, y: 120 },
      value: 1,
      ...style,
    };
    const outside: Mark = {
      id: "out",
      kind: "counter",
      at: { x: 400, y: 400 },
      value: 2,
      ...style,
    };
    const doc = setCrop(
      [inside, outside].reduce(addMark, createDoc(500, 500, 1)),
      { x: 100, y: 100, width: 80, height: 60 },
    );
    expect(exportRect(doc)).toEqual({ x: 100, y: 100, width: 80, height: 60 });
    expect(marksInRect(doc, exportRect(doc)).map((mark) => mark.id)).toEqual([
      "in",
    ]);
  });
});
