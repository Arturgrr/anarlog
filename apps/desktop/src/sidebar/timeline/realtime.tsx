import { forwardRef, useMemo, useState } from "react";

import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";
import { TZDate, format } from "@anlg/utils";

import { useTimeFormat } from "~/shared/hooks/useTimeFormat";

const MINUTE_MS = 60_000;
const CURRENT_TIME_TICK_OFFSET_MS = 100;

export const CurrentTimeIndicator = forwardRef<
  HTMLDivElement,
  { timezone?: string }
>(function CurrentTimeIndicator({ timezone }, ref) {
  const currentTimeMs = useCurrentTimeMs();
  const timeFormat = useTimeFormat();
  const label = useMemo(() => {
    const now = timezone
      ? new TZDate(new Date(currentTimeMs), timezone)
      : new Date(currentTimeMs);
    return format(now, timeFormat).toUpperCase();
  }, [currentTimeMs, timezone, timeFormat]);

  return (
    <div ref={ref} aria-hidden className="group relative z-30 h-px">
      <div className="absolute inset-x-0 top-0 -translate-y-1/2">
        <div
          data-sidebar-current-time-line
          className="bg-foreground/70 absolute top-1/2 right-0 left-0 h-px -translate-y-1/2"
        />
        <div className="relative flex h-5 items-center justify-center">
          <div
            data-sidebar-current-time-label
            className="bg-contrast text-primary-foreground shadow-elements rounded-sm px-2 py-0.5 font-mono text-[11px] font-semibold opacity-0 transition-opacity group-hover:opacity-100"
          >
            {label}
          </div>
        </div>
      </div>
    </div>
  );
});

export function useCurrentTimeMs(maxTickDelayMs = MINUTE_MS) {
  const [now, setNow] = useState(() => new Date().getTime());

  useMountEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const clearUpdate = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    };

    const scheduleUpdate = () => {
      clearUpdate();
      timeoutId = setTimeout(
        update,
        getCurrentTimeTickDelay(Date.now(), maxTickDelayMs),
      );
    };

    const update = () => {
      setNow(Date.now());
      scheduleUpdate();
    };

    const sync = () => {
      update();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        sync();
      }
    };

    sync();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearUpdate();
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  });

  return now;
}

function getCurrentTimeTickDelay(
  nowMs: number,
  maxTickDelayMs: number,
): number {
  const msIntoMinute = nowMs % MINUTE_MS;
  return Math.min(
    MINUTE_MS - msIntoMinute + CURRENT_TIME_TICK_OFFSET_MS,
    maxTickDelayMs,
  );
}
