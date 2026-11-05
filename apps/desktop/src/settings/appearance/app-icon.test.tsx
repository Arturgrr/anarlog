import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: vi.fn(() => "macos"),
  setAppIcon: vi.fn(),
  applyAppIconPreference: vi.fn(),
  appIcon: "default",
  appIdentifier: "com.arturgrr.librelog" as string | undefined,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mocks.appIdentifier }),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getIdentifier: vi.fn(),
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
    mocks.appIdentifier = "com.arturgrr.librelog";
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

  it.each([
    ["a removed icon variant", "walnut", "com.arturgrr.librelog", "Graphite"],
    ["the dev channel default", "default", "com.arturgrr.librelog.dev", "Light"],
  ])("selects the resolved icon for %s", (_, appIcon, identifier, label) => {
    mocks.appIcon = appIcon;
    mocks.appIdentifier = identifier;

    render(<AppIconSelector />);

    expect(
      screen.getByRole("radio", { name: label }).getAttribute("aria-checked"),
    ).toBe("true");
  });
});
