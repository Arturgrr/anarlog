import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CaptureEditor } from "./index";

const image = { width: 1600, height: 1000 } as ImageBitmap;

function setup() {
  const onClose = vi.fn();
  const resolved = () => Promise.resolve();
  render(
    <CaptureEditor
      image={image}
      scale={2}
      onCopy={resolved}
      onSave={resolved}
      onSaveAs={resolved}
      onClose={onClose}
    />,
  );
  const canvas = screen.getByTestId("capture-canvas");
  const drawRectangle = () => {
    fireEvent.keyDown(window, { key: "r" });
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 30, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 30, clientY: 30, pointerId: 1 });
  };
  return { onClose, drawRectangle };
}

describe("CaptureEditor", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  it("undoing the only drawn mark leaves nothing to discard on close", () => {
    const { onClose, drawRectangle } = setup();
    drawRectangle();
    expect(screen.getByRole("button", { name: "Undo" })).not.toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(screen.getByRole("button", { name: "Undo" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("asks before closing with unsaved changes", () => {
    const { onClose, drawRectangle } = setup();
    drawRectangle();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
