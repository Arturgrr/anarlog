import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: vi.fn(() => "macos"),
  setAppIcon: vi.fn(),
  applyAppIconPreference: vi.fn(),
  appIcon: "default",
  theme: "system",
  appIdentifier: "com.hyprnote.stable" as string | undefined,
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
  useConfigValue: (key: string) =>
    key === "theme" ? mocks.theme : mocks.appIcon,
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
    mocks.theme = "system";
    mocks.appIdentifier = "com.hyprnote.stable";
  });

  it.each([["system"], ["dark"]])(
    "applies and stores any icon for the %s theme without a paid plan",
    (theme) => {
      mocks.theme = theme;
      render(<AppIconSelector />);

      expect(
        screen
          .getByRole("radio", { name: "Default" })
          .getAttribute("aria-checked"),
      ).toBe("true");

      fireEvent.click(screen.getByRole("radio", { name: "Blueprint" }));

      expect(mocks.applyAppIconPreference).toHaveBeenCalledWith("dev", theme);
      expect(mocks.setAppIcon).toHaveBeenCalledWith("dev");
    },
  );

  it("selects default for an equivalent channel-specific preference", () => {
    mocks.appIcon = "stable";

    render(<AppIconSelector />);

    expect(
      screen
        .getByRole("radio", { name: "Default" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.queryByRole("radio", { name: "Production" })).toBeNull();
  });
});
