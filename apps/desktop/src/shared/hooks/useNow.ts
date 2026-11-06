import { useMemo, useSyncExternalStore } from "react";

import { TZDate } from "@anlg/utils";

import { useConfigValue } from "~/shared/config";

export function useTimezone() {
  return useConfigValue("timezone") || undefined;
}

export function toTz(date: Date | string, tz?: string): Date {
  const d = typeof date === "string" ? new Date(date) : date;
  return tz ? new TZDate(d, tz) : d;
}

export function useNow() {
  const tz = useTimezone();
  const store = useMemo(() => getNowStore(tz), [tz]);
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}

const nowStores = new Map<string, ReturnType<typeof createNowStore>>();

function getNowStore(timezone: string | undefined) {
  const key = timezone ?? "";
  let store = nowStores.get(key);
  if (!store) {
    store = createNowStore(timezone);
    nowStores.set(key, store);
  }
  return store;
}

function createNowStore(timezone: string | undefined) {
  let now = toTz(new Date(), timezone);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const scheduleRefresh = () => {
    clearTimeout(timeout);
    timeout = undefined;
    if (listeners.size === 0 || document.visibilityState === "hidden") return;
    const remainder = Date.now() % 60_000;
    timeout = setTimeout(
      refresh,
      remainder === 0 ? 60_000 : 60_000 - remainder,
    );
  };
  const refresh = () => {
    now = toTz(new Date(), timezone);
    listeners.forEach((listener) => listener());
    scheduleRefresh();
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") refresh();
    else scheduleRefresh();
  };
  const subscribe = (listener: () => void) => {
    if (listeners.size === 0) {
      window.addEventListener("focus", refresh);
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    listeners.add(listener);
    refresh();

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        scheduleRefresh();
        window.removeEventListener("focus", refresh);
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
    };
  };

  return { getSnapshot: () => now, subscribe };
}

function getSystemWeekStart(): 0 | 1 {
  const locale = navigator.language || "en-US";
  try {
    const options = new Intl.Locale(locale);
    const info = (options as any).getWeekInfo?.() ?? (options as any).weekInfo;
    if (info?.firstDay === 1) return 1;
  } catch {}
  return 0;
}

export function useWeekStartsOn(): 0 | 1 {
  const value = useConfigValue("week_start");
  return useMemo(() => {
    if (value === "monday") return 1;
    if (value === "sunday") return 0;
    return getSystemWeekStart();
  }, [value]);
}
