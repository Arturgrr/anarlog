import { describe, expect, it } from "vitest";

import { HudModel } from "./model";

/** Steps `model` at 60 fps from `from` for `seconds`; returns the last pose. */
function run(model: HudModel, from: number, seconds: number) {
  for (let n = 1; n <= Math.round(seconds * 60); n++) {
    model.step(from + n / 60, 1 / 60, false);
  }
  return model.scope.pose();
}

describe("dictation HUD", () => {
  it("shows processing before done even when the text arrives at once, then folds away", () => {
    const model = new HudModel();
    model.handle({ type: "started" }, 0, false);
    for (let n = 1; n <= 60; n++) {
      model.meter(10 ** ((-40 + 15 * Math.sin(n / 3)) / 20));
      model.step(n / 60, 1 / 60, false);
    }
    const recording = model.scope.pose();
    expect(recording.opacity).toBeGreaterThan(0.98);
    expect(recording.width).toBeCloseTo(112, 0);
    expect(
      model.scope.dots.some((value, i) => i % 2 === 0 && value > 0.45),
    ).toBe(true);

    model.handle({ type: "processing" }, 1, false);
    model.handle({ type: "completed" }, 1, false);
    run(model, 1, 0.15);
    expect(model.scope.stage).toBe("processing");
    run(model, 1.15, 0.1);
    expect(model.scope.stage).toBe("done");
    const done = run(model, 1.25, 2);
    expect(done.cool).toBeGreaterThan(0.99);
    expect(done.width).toBeCloseTo(76, 0);
    expect(model.active).toBe(false);
  });

  it("turns coral on failure and only fades on cancel", () => {
    const model = new HudModel();
    model.handle({ type: "started" }, 0, false);
    run(model, 0, 0.5);
    model.handle({ type: "failed" }, 0.5, false);
    expect(run(model, 0.5, 0.5).fail).toBeGreaterThan(0.9);
    run(model, 1, 1.5);
    expect(model.active).toBe(false);

    model.handle({ type: "started" }, 3, false);
    run(model, 3, 0.5);
    model.handle({ type: "cancelled" }, 3.5, false);
    expect(run(model, 3.5, 1.5).fail).toBeLessThan(0.01);
    expect(model.active).toBe(false);
  });
});
