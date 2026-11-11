import { describe, expect, it } from "vitest";

import { recordingEnvironmentConfig } from "./environment";

describe("recordingEnvironmentConfig", () => {
  it("turns stored settings into the native config, repairing values the native side would misread", () => {
    expect(
      recordingEnvironmentConfig({
        behavior: "duck",
        duckVolume: 35,
        pauseBrowser: true,
      }),
    ).toEqual({
      behavior: { type: "duck", volume: 0.35 },
      preventSleep: true,
    });
    expect(
      recordingEnvironmentConfig({
        behavior: "duck",
        duckVolume: Number.NaN,
        pauseBrowser: false,
      }).behavior,
    ).toEqual({ type: "duck", volume: 0.2 });
    expect(
      recordingEnvironmentConfig({
        behavior: "duck",
        duckVolume: 250,
        pauseBrowser: false,
      }).behavior,
    ).toEqual({ type: "duck", volume: 1 });
    expect(
      recordingEnvironmentConfig({
        behavior: "pause",
        duckVolume: 20,
        pauseBrowser: true,
      }).behavior,
    ).toEqual({ type: "pauseMedia", browsers: true });
    expect(
      recordingEnvironmentConfig({
        behavior: "louder",
        duckVolume: 20,
        pauseBrowser: false,
      }).behavior,
    ).toEqual({ type: "nothing" });
  });
});
