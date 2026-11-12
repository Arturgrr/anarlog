import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AudioSettingsView } from "./audio-settings";

function renderAudioSettings({
  microphoneDevice = {
    value: "",
    devices: ["External Microphone"],
    onChange: vi.fn(),
  },
  refineSpeakers = {
    value: false,
    onChange: vi.fn(),
  },
  rememberSpeakers = {
    value: false,
    onChange: vi.fn(),
  },
} = {}) {
  return render(
    <AudioSettingsView
      audioRetention={{ value: "forever", onChange: vi.fn() }}
      microphoneDevice={microphoneDevice}
      refineSpeakers={refineSpeakers}
      rememberSpeakers={rememberSpeakers}
    />,
  );
}

describe("AudioSettingsView", () => {
  afterEach(cleanup);

  it("shows when the selected microphone is unavailable and will fall back", () => {
    renderAudioSettings({
      microphoneDevice: {
        value: "Disconnected Microphone",
        devices: ["External Microphone"],
        onChange: vi.fn(),
      },
    });

    expect(
      screen.getByRole("combobox", { name: "Microphone" }).textContent,
    ).toContain(
      "Disconnected Microphone (Unavailable — using current default)",
    );
  });

  it.each([
    ["rememberSpeakers", "Remember speakers", false, true],
    ["rememberSpeakers", "Remember speakers", true, false],
    ["refineSpeakers", "Separate speakers after meetings", true, false],
  ] as const)(
    "toggles %s (%s) from %s to %s",
    (prop, name, value, nextValue) => {
      const onChange = vi.fn();
      renderAudioSettings({
        [prop]: { value, onChange },
      });

      const toggle = screen.getByRole("switch", { name });
      expect(toggle.getAttribute("aria-checked")).toBe(String(value));

      toggle.click();
      expect(onChange).toHaveBeenCalledWith(nextValue);
    },
  );
});
