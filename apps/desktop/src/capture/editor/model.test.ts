import { describe, expect, it } from "vitest";

import { normalizeRect } from "./geometry";
import { commit, createHistory, redo, undo } from "./history";
import {
  addMark,
  commitText,
  createDoc,
  type Doc,
  type Mark,
  markIsBigEnough,
  moveMark,
  nextCounterValue,
  removeMark,
  restyleMark,
  setCrop,
} from "./model";

const style = { color: "#ff3b30", size: "m" as const };

describe("moveMark", () => {
  const marks: Mark[] = [
    {
      id: "a",
      kind: "arrow",
      from: { x: 0, y: 0 },
      to: { x: 10, y: 10 },
      ...style,
    },
    {
      id: "b",
      kind: "ellipse",
      from: { x: 0, y: 0 },
      to: { x: 10, y: 10 },
      ...style,
    },
    {
      id: "c",
      kind: "pen",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      ...style,
    },
    { id: "d", kind: "text", at: { x: 0, y: 0 }, text: "hi", ...style },
    { id: "e", kind: "counter", at: { x: 0, y: 0 }, value: 1, ...style },
  ];
  const doc = marks.reduce(addMark, createDoc(100, 100, 1));

  it.each(marks.map((mark) => [mark.kind, mark.id]))(
    "moves a %s as a whole",
    (_, id) => {
      const moved = moveMark(doc, id, 5, -3).marks.find(
        (mark) => mark.id === id,
      )!;
      const points =
        "from" in moved
          ? [moved.from, moved.to]
          : "points" in moved
            ? moved.points
            : [moved.at];
      const original = doc.marks.find((mark) => mark.id === id)!;
      const before =
        "from" in original
          ? [original.from, original.to]
          : "points" in original
            ? original.points
            : [original.at];
      expect(points).toEqual(before.map((p) => ({ x: p.x + 5, y: p.y - 3 })));
    },
  );
});

describe("counters", () => {
  it("keeps the other numbers when one is deleted", () => {
    let doc = createDoc(100, 100, 1);
    for (const id of ["1", "2", "3"]) {
      doc = addMark(doc, {
        id,
        kind: "counter",
        at: { x: 0, y: 0 },
        value: nextCounterValue(doc),
        ...style,
      });
    }
    doc = removeMark(doc, "2");
    expect(
      doc.marks.map((mark) => mark.kind === "counter" && mark.value),
    ).toEqual([1, 3]);
    expect(nextCounterValue(doc)).toBe(4);
  });
});

describe("commitText", () => {
  const empty = createDoc(100, 100, 1);
  const edit = { id: null, at: { x: 1, y: 2 }, text: "Hello", ...style };

  it("adds new text and drops empty text", () => {
    expect(commitText(empty, edit).marks).toHaveLength(1);
    expect(commitText(empty, { ...edit, text: "  \n " })).toBe(empty);
  });

  it("updates edited text, removes text emptied while editing, ignores no-op edits", () => {
    const doc = commitText(empty, edit);
    const id = doc.marks[0].id;
    expect(
      commitText(doc, { ...edit, id, text: "Bye" }).marks[0],
    ).toMatchObject({ text: "Bye" });
    expect(commitText(doc, { ...edit, id, text: "" }).marks).toHaveLength(0);
    expect(commitText(doc, { ...edit, id })).toBe(doc);
  });
});

it("drops drags shorter than the minimum as clicks", () => {
  const box = (to: number): Mark => ({
    id: "b",
    kind: "rect",
    from: { x: 0, y: 0 },
    to: { x: to, y: to },
    ...style,
  });
  expect(markIsBigEnough(box(7), 2)).toBe(false);
  expect(markIsBigEnough(box(8), 2)).toBe(true);
});

describe("history", () => {
  it("undoes and redoes adds, moves, restyles, crops and deletes in order", () => {
    const steps: ((doc: Doc) => Doc)[] = [
      (doc) =>
        addMark(doc, {
          id: "r",
          kind: "rect",
          from: { x: 0, y: 0 },
          to: { x: 20, y: 20 },
          ...style,
        }),
      (doc) => moveMark(doc, "r", 10, 0),
      (doc) => restyleMark(doc, "r", { color: "#000000" }),
      (doc) => setCrop(doc, { x: 0, y: 0, width: 50, height: 50 }),
      (doc) => removeMark(doc, "r"),
    ];
    let history = createHistory(createDoc(100, 100, 1));
    const docs = [history.present];
    for (const step of steps) {
      history = commit(history, step(history.present));
      docs.push(history.present);
    }
    for (let i = docs.length - 2; i >= 0; i -= 1) {
      history = undo(history);
      expect(history.present).toBe(docs[i]);
    }
    expect(undo(history)).toBe(history);
    for (let i = 1; i < docs.length; i += 1) {
      history = redo(history);
      expect(history.present).toBe(docs[i]);
    }
    const rect = docs[3].marks[0];
    expect(rect.kind === "rect" && normalizeRect(rect.from, rect.to).x).toBe(
      10,
    );
    expect(rect.color).toBe("#000000");
  });

  it("drops the redo stack after a new change and ignores no-op commits", () => {
    let history = commit(
      createHistory(createDoc(10, 10, 1)),
      setCrop(createDoc(10, 10, 1), { x: 0, y: 0, width: 5, height: 5 }),
    );
    history = undo(history);
    history = commit(history, removeMark(history.present, "missing"));
    expect(history.future).toHaveLength(1);
    history = commit(
      history,
      addMark(history.present, {
        id: "c",
        kind: "counter",
        at: { x: 1, y: 1 },
        value: 1,
        ...style,
      }),
    );
    expect(history.future).toHaveLength(0);
  });
});
