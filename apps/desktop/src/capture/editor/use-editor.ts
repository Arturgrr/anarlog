import { useMutation } from "@tanstack/react-query";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { canvasMeasure, HANDLE_CURSORS, type Source, sourceSize } from "./draw";
import { flatten } from "./flatten";
import {
  clampRect,
  constrainAngle,
  constrainSquare,
  contains,
  cropIsBigEnough,
  type Handle,
  handleAt,
  hitTest,
  markHandles,
  moveRectWithin,
  normalizeRect,
  rectHandles,
  resizeMark,
  resizeRect,
  textLineHeight,
} from "./geometry";
import { commit, createHistory, type History, redo, undo } from "./history";
import {
  addMark,
  commitText,
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  findMark,
  HANDLE_PT,
  HIT_SLOP_PT,
  isBox,
  isSegment,
  isStroke,
  type Mark,
  markId,
  markIsBigEnough,
  moveMark,
  nextCounterValue,
  type Point,
  type Rect,
  removeMark,
  replaceMark,
  restyleMark,
  setCrop,
  type Size,
  type Style,
  type TextEdit,
  textPx,
  type Tool,
} from "./model";
import {
  computeView,
  FIT,
  panBy,
  type Stage,
  toImage,
  type View,
  type ViewState,
  zoomAround,
} from "./view";

type Interaction =
  | { type: "pan"; last: Point }
  | { type: "draw"; mark: Mark }
  | { type: "move"; id: string; origin: Point; base: Doc; next?: Doc }
  | { type: "resize"; id: string; handle: Handle; base: Doc; next?: Doc }
  | { type: "crop-new"; origin: Point; base: Rect | null }
  | { type: "crop-resize"; handle: Handle; base: Rect }
  | { type: "crop-move"; origin: Point; base: Rect };

export type ActionKind = "copy" | "save" | "saveAs";

const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  a: "arrow",
  l: "line",
  r: "rect",
  o: "ellipse",
  p: "pen",
  h: "highlighter",
  t: "text",
  x: "pixelate",
  n: "counter",
  c: "crop",
};

const DRAG_TOOLS = new Set<Tool>([
  "arrow",
  "line",
  "rect",
  "ellipse",
  "pixelate",
]);

export function uiUnit(scale: number, zoom: number) {
  return Math.min(Math.max(scale, 1 / zoom), 2 / zoom);
}

function isEditable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "TEXTAREA" ||
      target.tagName === "INPUT" ||
      target.isContentEditable)
  );
}

export function useEditor({
  image,
  scale,
  onCopy,
  onSave,
  onSaveAs,
  onClose,
}: {
  image: Source;
  scale: number;
  onCopy: (png: Blob) => Promise<void>;
  onSave: (png: Blob) => Promise<void>;
  /** Resolves false when the user cancelled choosing where. */
  onSaveAs: (png: Blob) => Promise<void | false>;
  onClose: () => void;
}) {
  const [history, setHistoryState] = useState<History<Doc>>(() => {
    const { width, height } = sourceSize(image);
    return createHistory(createDoc(width, height, scale));
  });
  const historyRef = useRef(history);
  const savedRef = useRef(history.present);
  const [draft, setDraft] = useState<Doc | null>(null);
  const [tool, setToolState] = useState<Tool>("select");
  const [style, setStyle] = useState<Style>(DEFAULT_STYLE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [textEdit, setTextEditState] = useState<TextEdit | null>(null);
  const textEditRef = useRef<TextEdit | null>(null);
  const [cropDraft, setCropDraft] = useState<Rect | null>(null);
  const [viewState, setViewState] = useState<ViewState>(FIT);
  const [stage, setStage] = useState<Stage>({ width: 0, height: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [hoverCursor, setHoverCursor] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const interaction = useRef<Interaction | null>(null);

  const doc = draft ?? history.present;
  const cropping = tool === "crop";
  const region =
    !cropping && doc.crop
      ? doc.crop
      : { x: 0, y: 0, width: doc.width, height: doc.height };
  const view: View = computeView(stage, region, scale, viewState);
  const unit = uiUnit(scale, view.zoom);
  const selected = tool === "select" ? findMark(doc, selectedId) : undefined;

  const updateHistory = useCallback(
    (fn: (current: History<Doc>) => History<Doc>) => {
      const next = fn(historyRef.current);
      if (next === historyRef.current) return;
      historyRef.current = next;
      setHistoryState(next);
    },
    [],
  );

  const apply = useCallback(
    (fn: (current: Doc) => Doc) =>
      updateHistory((h) => commit(h, fn(h.present))),
    [updateHistory],
  );

  const setTextEdit = (edit: TextEdit | null) => {
    textEditRef.current = edit;
    setTextEditState(edit);
  };

  const commitTextEdit = () => {
    const edit = textEditRef.current;
    if (!edit) return;
    setTextEdit(null);
    apply((current) => commitText(current, edit));
  };

  const setTool = (next: Tool) => {
    commitTextEdit();
    interaction.current = null;
    setDraft(null);
    setHoverCursor(null);
    if (next !== "select") setSelectedId(null);
    setCropDraft(next === "crop" ? historyRef.current.present.crop : null);
    if (next === "crop" || tool === "crop") setViewState(FIT);
    setToolState(next);
  };

  const restyle = (patch: Partial<Style>) => {
    setStyle((current) => ({ ...current, ...patch }));
    const edit = textEditRef.current;
    if (edit) {
      setTextEdit({ ...edit, ...patch });
      return;
    }
    const mark = findMark(historyRef.current.present, selectedId);
    if (tool === "select" && mark && mark.kind !== "pixelate") {
      apply((current) => restyleMark(current, mark.id, patch));
    }
  };

  const doUndo = () => {
    if (interaction.current) return;
    commitTextEdit();
    updateHistory(undo);
    if (cropping) setCropDraft(historyRef.current.present.crop);
  };

  const doRedo = () => {
    if (interaction.current) return;
    commitTextEdit();
    updateHistory(redo);
    if (cropping) setCropDraft(historyRef.current.present.crop);
  };

  const applyCrop = () => {
    if (cropDraft && cropIsBigEnough(cropDraft, scale)) {
      apply((current) => setCrop(current, cropDraft));
    }
    setCropDraft(null);
    setViewState(FIT);
    setToolState("select");
  };

  const cancelCrop = () => {
    interaction.current = null;
    setCropDraft(null);
    setViewState(FIT);
    setToolState("select");
  };

  const resetCrop = () => {
    apply((current) => setCrop(current, null));
    setCropDraft(null);
  };

  const zoomBy = (factor: number, anchor?: Point) =>
    setViewState((current) =>
      zoomAround(stage, region, scale, current, factor, anchor),
    );

  const zoomFit = () => setViewState(FIT);

  const callbacks = { copy: onCopy, save: onSave, saveAs: onSaveAs };
  const action = useMutation({
    mutationFn: async (kind: ActionKind) => {
      const current = historyRef.current.present;
      const done = await callbacks[kind](await flatten(current, image));
      return done === false ? null : current;
    },
    onSuccess: (exported) => {
      if (exported) savedRef.current = exported;
    },
  });
  const { reset: resetAction, status: actionStatus } = action;

  useEffect(() => {
    if (actionStatus !== "success" && actionStatus !== "error") return;
    const timer = setTimeout(
      resetAction,
      actionStatus === "success" ? 1600 : 6000,
    );
    return () => clearTimeout(timer);
  }, [actionStatus, resetAction]);

  const run = (kind: ActionKind) => {
    commitTextEdit();
    if (!action.isPending) action.mutate(kind);
  };

  const requestClose = () => {
    commitTextEdit();
    if (historyRef.current.present !== savedRef.current) {
      setConfirmClose(true);
      return;
    }
    onClose();
  };

  const toPoint = (event: {
    clientX: number;
    clientY: number;
    currentTarget: Element;
  }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return toImage(view, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  };

  const startText = (p: Point) => {
    const hit = hitTest(
      historyRef.current.present,
      p,
      HIT_SLOP_PT * unit,
      canvasMeasure,
    );
    const mark = findMark(historyRef.current.present, hit);
    if (mark?.kind === "text") {
      setTextEdit({
        id: mark.id,
        at: mark.at,
        text: mark.text,
        color: mark.color,
        size: mark.size,
      });
      return;
    }
    const half = textLineHeight(textPx(style.size, scale)) / 2;
    setTextEdit({
      id: null,
      at: { x: p.x, y: p.y - half },
      text: "",
      ...style,
    });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button === 2) return;
    if (textEditRef.current) {
      event.preventDefault();
      commitTextEdit();
      return;
    }
    setConfirmClose(false);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const screen = { x: event.clientX, y: event.clientY };
    if (spaceHeld || event.button === 1) {
      interaction.current = { type: "pan", last: screen };
      setHoverCursor("grabbing");
      return;
    }
    const p = toPoint(event);
    const present = historyRef.current.present;
    const style_ = { color: style.color, size: style.size };

    if (tool === "select") {
      const current = findMark(present, selectedId);
      const handle =
        current &&
        handleAt(markHandles(current), p, (HANDLE_PT / 2 + 2) * unit);
      if (current && handle) {
        interaction.current = {
          type: "resize",
          id: current.id,
          handle,
          base: present,
        };
        return;
      }
      const hit = hitTest(present, p, HIT_SLOP_PT * unit, canvasMeasure);
      setSelectedId(hit);
      if (hit)
        interaction.current = {
          type: "move",
          id: hit,
          origin: p,
          base: present,
        };
      return;
    }
    if (tool === "crop") {
      const handle =
        cropDraft &&
        handleAt(rectHandles(cropDraft, true), p, (HANDLE_PT / 2 + 2) * unit);
      if (cropDraft && handle) {
        interaction.current = { type: "crop-resize", handle, base: cropDraft };
      } else if (cropDraft && contains(cropDraft, p)) {
        interaction.current = { type: "crop-move", origin: p, base: cropDraft };
      } else {
        interaction.current = { type: "crop-new", origin: p, base: cropDraft };
      }
      return;
    }
    if (tool === "text") {
      event.preventDefault();
      startText(p);
      return;
    }
    if (tool === "counter") {
      apply((current) =>
        addMark(current, {
          id: markId(),
          kind: "counter",
          at: p,
          value: nextCounterValue(current),
          ...style_,
        }),
      );
      return;
    }
    const mark: Mark = DRAG_TOOLS.has(tool)
      ? ({ id: markId(), kind: tool, from: p, to: p, ...style_ } as Mark)
      : ({ id: markId(), kind: tool, points: [p], ...style_ } as Mark);
    interaction.current = { type: "draw", mark };
    setDraft(addMark(present, mark));
  };

  const hover = (p: Point) => {
    if (spaceHeld) return setHoverCursor("grab");
    if (tool === "select") {
      const current = findMark(historyRef.current.present, selectedId);
      const handle =
        current &&
        handleAt(markHandles(current), p, (HANDLE_PT / 2 + 2) * unit);
      if (handle) return setHoverCursor(HANDLE_CURSORS[handle]);
      const hit = hitTest(
        historyRef.current.present,
        p,
        HIT_SLOP_PT * unit,
        canvasMeasure,
      );
      return setHoverCursor(hit ? "move" : null);
    }
    if (tool === "crop" && cropDraft) {
      const handle = handleAt(
        rectHandles(cropDraft, true),
        p,
        (HANDLE_PT / 2 + 2) * unit,
      );
      if (handle) return setHoverCursor(HANDLE_CURSORS[handle]);
      return setHoverCursor(contains(cropDraft, p) ? "move" : null);
    }
    setHoverCursor(null);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = interaction.current;
    const p = toPoint(event);
    if (!current) return hover(p);
    const { width, height } = historyRef.current.present;
    switch (current.type) {
      case "pan": {
        const screen = { x: event.clientX, y: event.clientY };
        setViewState((state) =>
          panBy(
            stage,
            region,
            scale,
            state,
            screen.x - current.last.x,
            screen.y - current.last.y,
          ),
        );
        current.last = screen;
        return;
      }
      case "draw": {
        const mark = current.mark;
        let next: Mark = mark;
        if (isStroke(mark)) {
          const last = mark.points[mark.points.length - 1];
          if (Math.hypot(p.x - last.x, p.y - last.y) < 0.75 * scale) return;
          next = { ...mark, points: [...mark.points, p] };
        } else if (isSegment(mark)) {
          next = {
            ...mark,
            to: event.shiftKey ? constrainAngle(mark.from, p) : p,
          };
        } else if (isBox(mark)) {
          next = {
            ...mark,
            to: event.shiftKey ? constrainSquare(mark.from, p) : p,
          };
        }
        current.mark = next;
        setDraft(addMark(historyRef.current.present, next));
        return;
      }
      case "move": {
        current.next = moveMark(
          current.base,
          current.id,
          p.x - current.origin.x,
          p.y - current.origin.y,
        );
        setDraft(current.next);
        return;
      }
      case "resize": {
        const mark = findMark(current.base, current.id);
        if (mark) {
          current.next = replaceMark(
            current.base,
            resizeMark(mark, current.handle, p, event.shiftKey),
          );
          setDraft(current.next);
        }
        return;
      }
      case "crop-new":
        setCropDraft(
          clampRect(normalizeRect(current.origin, p), width, height),
        );
        return;
      case "crop-resize":
        setCropDraft(
          clampRect(resizeRect(current.base, current.handle, p), width, height),
        );
        return;
      case "crop-move":
        setCropDraft(
          moveRectWithin(
            current.base,
            p.x - current.origin.x,
            p.y - current.origin.y,
            width,
            height,
          ),
        );
    }
  };

  const onPointerUp = () => {
    const current = interaction.current;
    interaction.current = null;
    if (!current) return;
    if (current.type === "pan") {
      setHoverCursor(spaceHeld ? "grab" : null);
      return;
    }
    if (current.type === "draw") {
      setDraft(null);
      if (markIsBigEnough(current.mark, scale)) {
        apply((present) => addMark(present, current.mark));
      }
      return;
    }
    if (current.type === "move" || current.type === "resize") {
      const next = current.next;
      setDraft(null);
      if (next)
        updateHistory((h) =>
          h.present === current.base ? commit(h, next) : h,
        );
      return;
    }
    setCropDraft((rect) =>
      rect && cropIsBigEnough(rect, scale) ? rect : current.base,
    );
  };

  const onPointerCancel = () => {
    const current = interaction.current;
    interaction.current = null;
    setDraft(null);
    if (
      current?.type === "crop-new" ||
      current?.type === "crop-resize" ||
      current?.type === "crop-move"
    ) {
      setCropDraft(current.base);
    }
  };

  const onDoubleClick = (event: {
    clientX: number;
    clientY: number;
    currentTarget: Element;
  }) => {
    if (tool !== "select") return;
    const p = toPoint(event);
    const hit = hitTest(
      historyRef.current.present,
      p,
      HIT_SLOP_PT * unit,
      canvasMeasure,
    );
    const mark = findMark(historyRef.current.present, hit);
    if (mark?.kind === "text") {
      setSelectedId(null);
      setTextEdit({
        id: mark.id,
        at: mark.at,
        text: mark.text,
        color: mark.color,
        size: mark.size,
      });
    }
  };

  const onWheel = (event: WheelEvent, bounds: DOMRect) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const anchor = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
      zoomBy(Math.exp(-event.deltaY * 0.01), anchor);
      return;
    }
    setViewState((state) =>
      panBy(stage, region, scale, state, -event.deltaX, -event.deltaY),
    );
  };

  const onTextKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      commitTextEdit();
    }
  };

  const updateText = (text: string) => {
    const edit = textEditRef.current;
    if (edit) setTextEdit({ ...edit, text });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (isEditable(event.target) || event.isComposing) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const onButton = event.target instanceof HTMLButtonElement;

    if (mod) {
      const handled = (fn: () => void) => {
        event.preventDefault();
        fn();
      };
      if (key === "z") return handled(event.shiftKey ? doRedo : doUndo);
      if (key === "y") return handled(doRedo);
      if (key === "c" && !event.shiftKey) return handled(() => run("copy"));
      if (key === "s")
        return handled(() => run(event.shiftKey ? "saveAs" : "save"));
      if (key === "w") return handled(requestClose);
      if (key === "=" || key === "+") return handled(() => zoomBy(1.25));
      if (key === "-") return handled(() => zoomBy(0.8));
      if (key === "0") return handled(zoomFit);
      return;
    }
    if (event.altKey) return;

    if (key === "escape") {
      event.preventDefault();
      if (confirmClose) return setConfirmClose(false);
      if (interaction.current) return onPointerCancel();
      if (cropping) return cancelCrop();
      if (selected) return setSelectedId(null);
      return requestClose();
    }
    if (key === "enter" && cropping && !onButton) {
      event.preventDefault();
      return applyCrop();
    }
    if (key === " " && !onButton) {
      event.preventDefault();
      if (!spaceHeld) {
        setSpaceHeld(true);
        if (!interaction.current) setHoverCursor("grab");
      }
      return;
    }
    if ((key === "delete" || key === "backspace") && selected) {
      event.preventDefault();
      apply((current) => removeMark(current, selected.id));
      setSelectedId(null);
      return;
    }
    const arrows: Record<string, Point> = {
      arrowleft: { x: -1, y: 0 },
      arrowright: { x: 1, y: 0 },
      arrowup: { x: 0, y: -1 },
      arrowdown: { x: 0, y: 1 },
    };
    if (arrows[key] && selected && !interaction.current) {
      event.preventDefault();
      const step = scale * (event.shiftKey ? 10 : 1);
      apply((current) =>
        moveMark(
          current,
          selected.id,
          arrows[key].x * step,
          arrows[key].y * step,
        ),
      );
      return;
    }
    if (!event.shiftKey && TOOL_KEYS[key] && !event.repeat) {
      event.preventDefault();
      setTool(TOOL_KEYS[key]);
    }
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === " ") {
      setSpaceHeld(false);
      if (interaction.current?.type !== "pan") setHoverCursor(null);
    }
  };

  const keyHandlers = useRef({ onKeyDown, onKeyUp });
  keyHandlers.current = { onKeyDown, onKeyUp };
  useEffect(() => {
    const down = (event: KeyboardEvent) => keyHandlers.current.onKeyDown(event);
    const up = (event: KeyboardEvent) => keyHandlers.current.onKeyUp(event);
    const blur = () => setSpaceHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const cursor =
    hoverCursor ??
    (tool === "select" ? "default" : tool === "text" ? "text" : "crosshair");

  return {
    image,
    doc,
    view,
    unit,
    stage,
    setStage,
    tool,
    setTool,
    style,
    setColor: (color: string) => restyle({ color }),
    setSize: (size: Size) => restyle({ size }),
    selected,
    textEdit,
    updateText,
    commitTextEdit,
    onTextKeyDown,
    cropping,
    cropDraft,
    applyCrop,
    cancelCrop,
    resetCrop,
    hasCrop: history.present.crop !== null,
    undo: doUndo,
    redo: doRedo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    zoomIn: () => zoomBy(1.25),
    zoomOut: () => zoomBy(0.8),
    zoomFit,
    cursor,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onDoubleClick,
    onWheel,
    run,
    action,
    confirmClose,
    discard: onClose,
    keepEditing: () => setConfirmClose(false),
  };
}

export type Editor = ReturnType<typeof useEditor>;
