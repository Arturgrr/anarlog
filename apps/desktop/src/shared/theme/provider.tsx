import {
  getCurrentWindow,
  type Theme,
  type Window,
} from "@tauri-apps/api/window";
import type { ReactNode } from "react";

import { commands as iconCommands } from "@anlg/plugin-icon";
import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";

import { applyDocumentTheme, writeStoredThemePreference } from "./apply";
import {
  type AppIconPreference,
  normalizeAppIconPreference,
  resolveAppIconName,
} from "./icon";
import type { ThemePreference } from "./resolve";
import { useSettingsThemeReady } from "./use-settings-theme-ready";

import { useConfigValue } from "~/shared/config";

let activeThemePreference: ThemePreference = "system";

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const theme = useConfigValue("theme") as ThemePreference;
  const appIcon = normalizeAppIconPreference(useConfigValue("app_icon"));
  const settingsReady = useSettingsThemeReady();

  return (
    <>
      {settingsReady ? (
        <>
          <ThemeSync key={theme} theme={theme} />
          <DockIconSync key={appIcon} appIcon={appIcon} />
        </>
      ) : null}
      {children}
    </>
  );
}

function ThemeSync({ theme }: { theme: ThemePreference }) {
  useMountEffect(() => {
    activeThemePreference = theme;
    const appWindow = getCurrentWindow();
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const applySystemTheme = (systemIsDark: boolean) => {
      if (cancelled || activeThemePreference !== theme) {
        return;
      }

      applyAppearance(theme, systemIsDark);
    };

    const refreshSystemTheme = async () => {
      applySystemTheme(await readSystemIsDark(appWindow));
    };

    if (theme !== "system") {
      applySystemTheme(theme === "dark");
      void setNativeThemePreference(appWindow, theme);

      return () => {
        cancelled = true;
      };
    }

    const handleSystemThemeChange = () => {
      void refreshSystemTheme();
    };

    systemTheme.addEventListener("change", handleSystemThemeChange);
    window.addEventListener("focus", handleSystemThemeChange);

    void (async () => {
      await setNativeThemePreference(appWindow, theme);
      unlisten = await appWindow.onThemeChanged(({ payload }) => {
        applySystemTheme(payload === "dark");
      });

      if (cancelled) {
        unlisten();
        return;
      }

      await refreshSystemTheme();
    })().catch((error) => {
      if (!cancelled) {
        console.error("[theme] failed to follow system appearance", error);
        applySystemTheme(systemTheme.matches);
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
      systemTheme.removeEventListener("change", handleSystemThemeChange);
      window.removeEventListener("focus", handleSystemThemeChange);
    };
  });

  return null;
}

function DockIconSync({ appIcon }: { appIcon: AppIconPreference }) {
  useMountEffect(() => {
    void applyAppIconPreference(appIcon);
  });

  return null;
}

export async function applyThemePreference(theme: ThemePreference) {
  activeThemePreference = theme;
  const appWindow = getCurrentWindow();

  if (theme !== "system") {
    applyAppearance(theme, theme === "dark");
    await setNativeThemePreference(appWindow, theme);
    return;
  }

  await setNativeThemePreference(appWindow, theme);
  applyAppearance(theme, await readSystemIsDark(appWindow));
}

function applyAppearance(theme: ThemePreference, systemIsDark: boolean) {
  applyDocumentTheme(theme, systemIsDark);
  writeStoredThemePreference(theme);
}

export async function applyAppIconPreference(appIcon: AppIconPreference) {
  try {
    const result = await iconCommands.setDockIcon(resolveAppIconName(appIcon));
    if (result.status === "error") {
      console.error("[theme] failed to update Dock icon", result.error);
    }
  } catch (error) {
    console.error("[theme] failed to update Dock icon", error);
  }
}

async function setNativeThemePreference(
  appWindow: Window,
  theme: ThemePreference,
) {
  try {
    await appWindow.setTheme(theme === "system" ? null : theme);
  } catch (error) {
    console.error("[theme] failed to update native appearance", error);
  }
}

async function readSystemIsDark(appWindow: Window): Promise<boolean> {
  try {
    return isDarkTheme(await appWindow.theme());
  } catch (error) {
    console.error("[theme] failed to read system appearance", error);
    return prefersDarkColorScheme();
  }
}

function isDarkTheme(theme: Theme | null): boolean {
  return theme === null ? prefersDarkColorScheme() : theme === "dark";
}

function prefersDarkColorScheme(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
