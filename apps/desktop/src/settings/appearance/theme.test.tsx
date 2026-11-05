import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setTheme: vi.fn(),
  applyThemePreference: vi.fn(),
  theme: "system",
}));

vi.mock("~/settings/queries", () => ({
  useSetSettingValue: () => mocks.setTheme,
}));

vi.mock("~/shared/config", () => ({
  useConfigValue: () => mocks.theme,
}));

vi.mock("~/shared/theme/provider", () => ({
  applyThemePreference: mocks.applyThemePreference,
}));

import { ThemeSelector } from "./theme";

describe("ThemeSelector", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.theme = "system";
  });

  it("applies and stores the selected theme", () => {
    render(<ThemeSelector />);

    expect(
      screen
        .getByRole("radio", { name: /System/ })
        .getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: /Dark/ }));

    expect(mocks.applyThemePreference).toHaveBeenCalledWith("dark");
    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
  });
});
