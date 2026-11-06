import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appVersion: "0.1.0-beta.1",
  openUrl: vi.fn(() => Promise.resolve({ status: "ok", data: null })),
}));

vi.mock("@anlg/plugin-misc", () => ({
  commands: {
    getDeviceInfo: () =>
      Promise.resolve({
        status: "ok",
        data: {
          platform: "macos",
          arch: "aarch64",
          totalMemoryBytes: 0,
          osVersion: "macOS 15.5 Sequoia",
          appVersion: mocks.appVersion,
        },
      }),
  },
}));

vi.mock("@anlg/plugin-opener2", () => ({
  commands: { openUrl: mocks.openUrl, openPath: vi.fn() },
}));

vi.mock("@anlg/plugin-tracing", () => ({
  commands: { logsDir: vi.fn() },
}));

import { AboutSettingsView } from "./about";

import { useTabs } from "~/store/zustand/tabs";

function renderAbout() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AboutSettingsView />
    </QueryClientProvider>,
  );
}

describe("AboutSettingsView", () => {
  afterEach(() => {
    cleanup();
    useTabs.setState({ tabs: [], currentTab: null });
    mocks.appVersion = "0.1.0-beta.1";
    mocks.openUrl.mockClear();
  });

  it("reopens the installed version's release notes after closing them", async () => {
    renderAbout();
    const button = screen.getByRole("button", { name: "Show release notes" });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    fireEvent.click(button);
    const tab = useTabs.getState().currentTab!;
    expect(tab).toMatchObject({
      type: "changelog",
      state: { current: "0.1.0-beta.1" },
    });
    useTabs.getState().close(tab);
    fireEvent.click(button);
    expect(useTabs.getState().currentTab).toMatchObject({
      type: "changelog",
      state: { current: "0.1.0-beta.1" },
    });
  });

  it("marks only beta builds as Beta", async () => {
    renderAbout();
    await screen.findByText("Librelog 0.1.0-beta.1");
    expect(screen.getByText("Beta")).toBeTruthy();

    cleanup();
    mocks.appVersion = "0.1.0";
    renderAbout();
    await screen.findByText("Librelog 0.1.0");
    expect(screen.queryByText("Beta")).toBeNull();
  });

  it("reports a problem through the prefilled GitHub issue form", async () => {
    renderAbout();
    const button = screen.getByRole("button", { name: "Report a problem" });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    fireEvent.click(button);

    await waitFor(() =>
      expect(mocks.openUrl).toHaveBeenCalledWith(
        "https://github.com/Arturgrr/librelog/issues/new?template=bug_report.yml&version=0.1.0-beta.1&macos=macOS+15.5+Sequoia&chip=Apple+silicon+%28arm64+build%29",
        null,
      ),
    );
  });
});
