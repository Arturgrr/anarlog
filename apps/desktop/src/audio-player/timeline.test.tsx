import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const setPlaybackRate = vi.hoisted(() => vi.fn());

vi.mock("./provider", () => ({
  useAudioPlayer: () => ({
    registerContainer: () => {},
    state: "paused",
    pause: vi.fn(),
    resume: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    playbackRate: 1,
    setPlaybackRate,
    deleteRecording: vi.fn(),
    isDeletingRecording: false,
  }),
  useAudioTime: () => ({ current: 0, total: 60 }),
}));

vi.mock("~/shared/hooks/useNativeContextMenu", () => ({
  useNativeContextMenu: () => vi.fn(),
}));

import { Timeline } from "./timeline";

afterEach(cleanup);

it("lets anyone change the playback speed without a paid plan", async () => {
  render(<Timeline />);

  const trigger = screen.getByRole("button", { name: "1x" });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("menuitem", { name: "1.5x" }));

  expect(setPlaybackRate).toHaveBeenCalledWith(1.5);
});
