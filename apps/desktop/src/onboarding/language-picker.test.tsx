import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setSettingValues: vi.fn(),
}));

vi.mock("~/settings/queries", () => ({
  useSetSettingValues: () => mocks.setSettingValues,
  useStoredSettingValues: () => ({
    values: { ai_language: "en-US", spoken_languages: '["pt-BR","de"]' },
    hasValues: new Set(["ai_language", "spoken_languages"]),
  }),
}));

import { WelcomeLanguagePicker } from "./language-picker";

describe("WelcomeLanguagePicker", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("stores the language chosen on the welcome screen as the main language", () => {
    render(<WelcomeLanguagePicker />);

    fireEvent.click(
      screen.getByRole("combobox", { name: "Language: English" }),
    );
    fireEvent.change(screen.getByPlaceholderText("Search language..."), {
      target: { value: "portuguese" },
    });
    fireEvent.click(screen.getByRole("option", { name: /Português/ }));

    expect(mocks.setSettingValues).toHaveBeenCalledWith({
      ai_language: "pt",
      spoken_languages: '["de"]',
    });
  });
});
