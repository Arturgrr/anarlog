// The dictation HUD's page on Windows and Linux (`dictation-hud.html`): the
// scope in a transparent, click-through window the dictation plugin places at
// the top or the bottom of the display under the pointer, and Hex's live text
// plate on the side of it facing the screen's middle. The page keeps the HUD's
// clock and says when it has faded out.

import { emit, listen } from "@tauri-apps/api/event";

import type { HudEvent } from "@anlg/plugin-dictation";

import { HudModel } from "./model";
import { createHudRenderer } from "./renderer";

const canvas = document.querySelector<HTMLCanvasElement>("#scope")!;
const plate = document.querySelector<HTMLElement>("#live-text")!;
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const reduceQuery = matchMedia("(prefers-reduced-motion: reduce)");

const model = new HudModel();
let renderer: ReturnType<typeof createHudRenderer> = null;
try {
  renderer = createHudRenderer(canvas);
} catch (error) {
  console.error("Dictation HUD: WebGL2 is unavailable", error);
}
let session = 0;
let stable = "";
let tentative = "";
let frame = 0;
let last: number | null = null;

function now() {
  return performance.now() / 1000;
}

function tick(time: number) {
  frame = 0;
  const dt = last === null ? 1 / 60 : (time - last) / 1000;
  last = time;
  model.step(now(), dt, reduceQuery.matches);
  renderer?.draw(model, darkQuery.matches, devicePixelRatio);
  if (!model.recording && !plate.hidden) plate.hidden = true;
  if (model.active) {
    frame = requestAnimationFrame(tick);
  } else {
    void emit("dictation-hud:settled", { session });
  }
}

function wake() {
  if (frame) return;
  last = null;
  frame = requestAnimationFrame(tick);
}

const measure = document.createElement("canvas").getContext("2d")!;

/** One line; the newest words stay in view and the start gives way with "…". */
function layoutLiveText() {
  const words = stable.trim();
  const after = words ? tentative : tentative.trimStart();
  if (!model.recording || (!words && !after.trim())) {
    plate.hidden = true;
    return;
  }
  const style = getComputedStyle(plate);
  measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const room = parseFloat(style.maxWidth) - 2 * parseFloat(style.paddingLeft);
  const full = words + after;
  const fits = (cut: number) =>
    measure.measureText((cut ? "…" : "") + full.slice(cut)).width <= room;
  let cut = 0;
  if (!fits(0)) {
    let low = 1;
    let high = full.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (fits(middle)) high = middle;
      else low = middle + 1;
    }
    cut = low;
  }
  const shownStable = words.slice(Math.min(cut, words.length));
  const shownTentative = after.slice(Math.max(cut - words.length, 0));
  const lead = cut ? "…" : "";
  plate.replaceChildren(
    Object.assign(document.createElement("span"), {
      className: "stable",
      textContent: lead + shownStable,
    }),
    Object.assign(document.createElement("span"), {
      className: "tentative",
      textContent: shownStable ? shownTentative : lead + shownTentative,
    }),
  );
  plate.hidden = false;
}

void (async () => {
  await listen<{ session: number; event: HudEvent }>(
    "dictation-hud:event",
    ({ payload }) => {
      const { event } = payload;
      if (event.type === "started") {
        session = payload.session;
        document.documentElement.classList.toggle(
          "bottom",
          event.position === "bottom",
        );
        stable = "";
        tentative = "";
      }
      if (event.type === "preview") {
        stable = event.stable;
        tentative = event.tentative;
      } else {
        model.handle(event, now(), reduceQuery.matches);
        wake();
      }
      layoutLiveText();
    },
  );
  await listen<number>("dictation-hud:meter", ({ payload }) => {
    model.meter(payload);
  });
  await emit("dictation-hud:ready");
})();
