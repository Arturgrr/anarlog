import { type Point, type Rect } from "./model";

export type ViewState = { zoom: number | null; pan: Point };
export type Stage = { width: number; height: number };
export type View = { zoom: number; x: number; y: number };

const PAD = 24;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;

export const FIT: ViewState = { zoom: null, pan: { x: 0, y: 0 } };

export function fitZoom(stage: Stage, region: Rect, scale: number) {
  return Math.max(
    MIN_ZOOM,
    Math.min(
      (stage.width - PAD * 2) / region.width,
      (stage.height - PAD * 2) / region.height,
      1 / scale,
    ),
  );
}

function axis(
  size: number,
  start: number,
  length: number,
  zoom: number,
  pan: number,
) {
  const content = length * zoom;
  if (content <= size - PAD * 2) return (size - content) / 2 - start * zoom;
  const offset = Math.min(
    PAD,
    Math.max(size - content - PAD, (size - content) / 2 + pan),
  );
  return offset - start * zoom;
}

export function computeView(
  stage: Stage,
  region: Rect,
  scale: number,
  state: ViewState,
): View {
  const zoom = state.zoom ?? fitZoom(stage, region, scale);
  return {
    zoom,
    x: axis(stage.width, region.x, region.width, zoom, state.pan.x),
    y: axis(stage.height, region.y, region.height, zoom, state.pan.y),
  };
}

export function toImage(view: View, screen: Point): Point {
  return {
    x: (screen.x - view.x) / view.zoom,
    y: (screen.y - view.y) / view.zoom,
  };
}

function settle(
  stage: Stage,
  region: Rect,
  zoom: number,
  origin: Point,
): ViewState {
  const pan = {
    x: origin.x + region.x * zoom - (stage.width - region.width * zoom) / 2,
    y: origin.y + region.y * zoom - (stage.height - region.height * zoom) / 2,
  };
  const view = computeView(stage, region, 1, { zoom, pan });
  return {
    zoom,
    pan: {
      x: view.x + region.x * zoom - (stage.width - region.width * zoom) / 2,
      y: view.y + region.y * zoom - (stage.height - region.height * zoom) / 2,
    },
  };
}

export function zoomAround(
  stage: Stage,
  region: Rect,
  scale: number,
  state: ViewState,
  factor: number,
  anchor: Point = { x: stage.width / 2, y: stage.height / 2 },
): ViewState {
  const view = computeView(stage, region, scale, state);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  const p = toImage(view, anchor);
  return settle(stage, region, zoom, {
    x: anchor.x - p.x * zoom,
    y: anchor.y - p.y * zoom,
  });
}

export function panBy(
  stage: Stage,
  region: Rect,
  scale: number,
  state: ViewState,
  dx: number,
  dy: number,
): ViewState {
  const view = computeView(stage, region, scale, state);
  return settle(stage, region, view.zoom, { x: view.x + dx, y: view.y + dy });
}
