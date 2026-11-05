import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const themeState = vi.hoisted(() => ({
  settingsReady: false,
  theme: "system" as "light" | "dark" | "system",
  appIcon: "default" as string,
}));

const applyDocumentTheme = vi.hoisted(() =>
  vi.fn((theme: string, prefersDark?: boolean) =>
    theme === "dark" ? true : theme === "system" && prefersDark === true,
  ),
);
const writeStoredThemePreference = vi.hoisted(() => vi.fn());
const setDockIcon = vi.hoisted(() =>
  vi.fn(async () => ({ status: "ok", data: null })),
);
const getIdentifier = vi.hoisted(() =>
  vi.fn(async () => "com.hyprnote.stable"),
);
const nativeTheme = vi.hoisted(() => vi.fn(async () => "light"));
const setNativeTheme = vi.hoisted(() => vi.fn(async () => undefined));
const onThemeChanged = vi.hoisted(() =>
  vi.fn(async (_listener: (event: { payload: "light" | "dark" }) => void) =>
    vi.fn(),
  ),
);
const matchMedia = vi.hoisted(() => vi.fn());
const systemTheme = vi.hoisted(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({ getIdentifier }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    theme: nativeTheme,
    setTheme: setNativeTheme,
    onThemeChanged,
  }),
}));

vi.mock("@anlg/plugin-icon", () => ({
  commands: { setDockIcon },
}));

vi.mock("./apply", () => ({
  applyDocumentTheme,
  writeStoredThemePreference,
}));

vi.mock("./use-settings-theme-ready", () => ({
  useSettingsThemeReady: () => themeState.settingsReady,
}));

vi.mock("~/shared/config", () => ({
  useConfigValue: (key: string) => {
    if (key === "app_icon") {
      return themeState.appIcon;
    }
    return themeState.theme;
  },
}));

import { AppThemeProvider, applyThemePreference } from "./provider";

function renderProvider() {
  return render(
    <AppThemeProvider>
      <div>child</div>
    </AppThemeProvider>,
  );
}

describe("AppThemeProvider", () => {
  beforeEach(() => {
    cleanup();
    themeState.settingsReady = false;
    themeState.theme = "system";
    themeState.appIcon = "default";
    applyDocumentTheme.mockClear();
    writeStoredThemePreference.mockClear();
    setDockIcon.mockClear();
    getIdentifier.mockReset();
    getIdentifier.mockResolvedValue("com.hyprnote.stable");
    nativeTheme.mockReset();
    nativeTheme.mockResolvedValue("light");
    setNativeTheme.mockReset();
    setNativeTheme.mockResolvedValue(undefined);
    onThemeChanged.mockReset();
    onThemeChanged.mockResolvedValue(vi.fn());
    systemTheme.matches = false;
    systemTheme.addEventListener.mockReset();
    systemTheme.removeEventListener.mockReset();
    matchMedia.mockReset();
    matchMedia.mockReturnValue(systemTheme);
    document.documentElement.classList.remove("dark");
    window.matchMedia = matchMedia;
  });

  afterEach(() => {
    cleanup();
  });

  it("does not clobber the boot theme before settings hydrate", () => {
    renderProvider();

    expect(applyDocumentTheme).not.toHaveBeenCalled();
    expect(writeStoredThemePreference).not.toHaveBeenCalled();
    expect(setDockIcon).not.toHaveBeenCalled();
    expect(setNativeTheme).not.toHaveBeenCalled();
  });

  it("applies the hydrated settings theme once SQLite is ready", async () => {
    themeState.settingsReady = true;
    themeState.theme = "light";

    renderProvider();

    await waitFor(() =>
      expect(applyDocumentTheme).toHaveBeenCalledWith("light", false),
    );
    expect(writeStoredThemePreference).toHaveBeenCalledWith("light");
    await waitFor(() => expect(setDockIcon).toHaveBeenCalledWith("graphite"));
    expect(setNativeTheme).toHaveBeenCalledWith("light");
    expect(onThemeChanged).not.toHaveBeenCalled();
    expect(systemTheme.addEventListener).not.toHaveBeenCalled();
  });

  it("uses the native appearance for the system theme", async () => {
    themeState.settingsReady = true;
    themeState.theme = "system";
    nativeTheme.mockResolvedValue("dark");

    renderProvider();

    await waitFor(() =>
      expect(applyDocumentTheme).toHaveBeenCalledWith("system", true),
    );
    expect(setNativeTheme).toHaveBeenCalledWith(null);
    expect(writeStoredThemePreference).toHaveBeenCalledWith("system");
    await waitFor(() => expect(setDockIcon).toHaveBeenCalledWith("graphite"));
  });

  it.each([
    {
      name: "dev channel default",
      identifier: "com.hyprnote.dev",
      appIcon: "default",
      expected: "light",
    },
    {
      name: "stable fallback",
      identifier: new Error("unavailable"),
      appIcon: "default",
      expected: "graphite",
    },
    {
      name: "removed icon variant",
      identifier: "com.hyprnote.stable",
      appIcon: "anagram",
      expected: "graphite",
    },
    {
      name: "light selection",
      identifier: "com.hyprnote.stable",
      appIcon: "light",
      expected: "light",
    },
  ])("uses the $expected Dock icon for a $name", async (scenario) => {
    themeState.settingsReady = true;
    themeState.appIcon = scenario.appIcon;
    if (scenario.identifier instanceof Error) {
      getIdentifier.mockRejectedValue(scenario.identifier);
    } else {
      getIdentifier.mockResolvedValue(scenario.identifier);
    }

    renderProvider();

    await waitFor(() =>
      expect(setDockIcon).toHaveBeenCalledWith(scenario.expected),
    );
  });

  it("rechecks native appearance when the webview reports a change", async () => {
    themeState.settingsReady = true;
    themeState.theme = "system";

    renderProvider();

    await waitFor(() => expect(applyDocumentTheme).toHaveBeenCalledOnce());
    const handleWebviewThemeChanged =
      systemTheme.addEventListener.mock.calls[0]?.[1];
    applyDocumentTheme.mockClear();
    nativeTheme.mockClear();
    nativeTheme.mockResolvedValue("dark");

    handleWebviewThemeChanged({ matches: false });

    await waitFor(() =>
      expect(applyDocumentTheme).toHaveBeenCalledWith("system", true),
    );
    expect(nativeTheme).toHaveBeenCalledOnce();
  });

  it("ignores stale system events after leaving system appearance", async () => {
    themeState.settingsReady = true;
    themeState.theme = "system";

    const { rerender } = renderProvider();

    await waitFor(() => expect(onThemeChanged).toHaveBeenCalledOnce());
    await waitFor(() => expect(applyDocumentTheme).toHaveBeenCalledOnce());
    const handleThemeChanged = onThemeChanged.mock.calls[0]?.[0];

    themeState.theme = "light";
    rerender(
      <AppThemeProvider>
        <div>child</div>
      </AppThemeProvider>,
    );
    handleThemeChanged({ payload: "dark" });

    expect(applyDocumentTheme).toHaveBeenCalledTimes(2);
    expect(applyDocumentTheme).toHaveBeenLastCalledWith("light", false);
  });

  it("ignores a system event emitted while applying an explicit theme", async () => {
    themeState.settingsReady = true;
    themeState.theme = "system";

    renderProvider();

    await waitFor(() => expect(onThemeChanged).toHaveBeenCalledOnce());
    const handleThemeChanged = onThemeChanged.mock.calls[0]?.[0];
    setNativeTheme.mockImplementationOnce(async () => {
      handleThemeChanged({ payload: "light" });
    });
    applyDocumentTheme.mockClear();
    writeStoredThemePreference.mockClear();

    await applyThemePreference("light");

    expect(applyDocumentTheme).toHaveBeenCalledOnce();
    expect(applyDocumentTheme).toHaveBeenCalledWith("light", false);
    expect(writeStoredThemePreference).toHaveBeenCalledOnce();
    expect(writeStoredThemePreference).toHaveBeenCalledWith("light");
  });

  it("applies a selected system theme from the native appearance", async () => {
    nativeTheme.mockResolvedValue("dark");

    await applyThemePreference("system");

    expect(setNativeTheme).toHaveBeenCalledWith(null);
    expect(nativeTheme).toHaveBeenCalledOnce();
    expect(applyDocumentTheme).toHaveBeenCalledWith("system", true);
    expect(writeStoredThemePreference).toHaveBeenCalledWith("system");
  });

  it.each([
    ["light", false],
    ["dark", true],
  ] as const)(
    "applies the selected %s theme immediately",
    async (theme, isDark) => {
      await applyThemePreference(theme);

      expect(setNativeTheme).toHaveBeenCalledWith(theme);
      expect(nativeTheme).not.toHaveBeenCalled();
      expect(applyDocumentTheme).toHaveBeenCalledWith(theme, isDark);
      expect(writeStoredThemePreference).toHaveBeenCalledWith(theme);
    },
  );
});
