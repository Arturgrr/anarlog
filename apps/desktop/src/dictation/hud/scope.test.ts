import { describe, expect, it } from "vitest";

import { AutoLevel } from "./scope";
import { Spring } from "./spring";

const H = 1 / 240;

/** Syllables peaking at `peak` dB over a room at `room` dB, 4 a second. */
function speak(auto: AutoLevel, peak: number, room: number, seconds: number) {
  const levels: number[] = [];
  for (let i = 0; i < seconds / H; i++) {
    const syllable = Math.max(Math.sin(2 * Math.PI * 4 * i * H), 0);
    levels.push(
      auto.step(room + (peak - room) * Math.sqrt(syllable), H, 3, -60),
    );
  }
  return levels;
}

function high(levels: number[]) {
  const sorted = levels.slice().sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length * 9) / 10)]!;
}

describe("dictation HUD scope", () => {
  it("moves a quiet microphone as far as a loud one without boosting the room", () => {
    const quiet = new AutoLevel();
    speak(quiet, -36, -58, 4);
    const loud = new AutoLevel();
    speak(loud, -14, -50, 4);
    expect(high(speak(quiet, -36, -58, 2))).toBeGreaterThan(0.8);
    expect(high(speak(loud, -14, -50, 2))).toBeGreaterThan(0.8);

    let fan = 1;
    for (let i = 0; i < 20 / H; i++) fan = loud.step(-48, H, 3, -60);
    expect(fan).toBeLessThan(0.05);
    expect(loud.peak).toBeGreaterThanOrEqual(loud.room + 16 - 0.01);
  });

  it("springs land in the same place at any frame rate", () => {
    const settle = (hz: number, bounce: number) => {
      const spring = new Spring(0);
      for (let i = 0; i < hz / 2; i++) {
        spring.stepTo(1, { duration: 0.3, bounce }, 1 / hz);
      }
      return spring.x;
    };
    for (const bounce of [0, 0.15, -0.25]) {
      expect(settle(60, bounce)).toBeCloseTo(settle(240, bounce), 4);
    }
  });
});
