import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: vi.fn(() => "macos"),
  setAppIcon: vi.fn(),
  applyAppIconPreference: vi.fn(),
  appIcon: "default",
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: mocks.platform,
}));

vi.mock("~/settings/queries", () => ({
  useSetSettingValue: () => mocks.setAppIcon,
}));

vi.mock("~/shared/config", () => ({
  useConfigValue: () => mocks.appIcon,
}));

vi.mock("~/shared/theme/provider", () => ({
  applyAppIconPreference: mocks.applyAppIconPreference,
}));

import { AppIconSelector } from "./app-icon";

describe("AppIconSelector", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.platform.mockReturnValue("macos");
    mocks.appIcon = "default";
  });

  it("applies and stores the selected icon", () => {
    render(<AppIconSelector />);

    expect(
      screen
        .getByRole("radio", { name: "Graphite" })
        .getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: "Light" }));

    expect(mocks.applyAppIconPreference).toHaveBeenCalledWith("light");
    expect(mocks.setAppIcon).toHaveBeenCalledWith("light");
  });

  it("selects Graphite for a removed icon variant", () => {
    mocks.appIcon = "walnut";

    render(<AppIconSelector />);

    expect(
      screen
        .getByRole("radio", { name: "Graphite" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });
});
