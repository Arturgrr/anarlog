import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";

import { purgeExpiredDictations } from "./store";

import { useSettingsReady } from "~/settings/queries";
import { useConfigValue } from "~/shared/config";

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

/** Purges expired dictations at start, when retention changes, and hourly. */
export function DictationHistoryRetention() {
  const ready = useSettingsReady();
  const retention = useConfigValue("dictation_history_retention");
  return ready ? <Purge key={retention} /> : null;
}

function Purge() {
  useMountEffect(() => {
    const purge = () => {
      void purgeExpiredDictations().catch((error) => {
        console.error("[dictation-history] purge failed", error);
      });
    };
    purge();
    const timer = setInterval(purge, PURGE_INTERVAL_MS);
    return () => clearInterval(timer);
  });
  return null;
}
