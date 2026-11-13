import { useLiveQuery } from "~/db";
import { normalizeRetention, retentionCutoff } from "~/dictation/history/store";
import { useConfigValue } from "~/shared/config";
import { useNow } from "~/shared/hooks/useNow";

export type DictationStatsRow = {
  created_at: string;
  duration_ms: number;
  target_app_name: string | null;
  target_app_id: string | null;
  language: string | null;
  raw_text: string;
  final_text: string;
};

export const DICTATION_STATS_SQL = `
  SELECT created_at, duration_ms, target_app_name, target_app_id, language,
    raw_text, final_text
  FROM dictation_history
`;

export function useDictationStats() {
  const retention = normalizeRetention(
    useConfigValue("dictation_history_retention"),
  );
  const now = useNow();
  const query = useLiveQuery<DictationStatsRow, DictationStatsRow[]>({
    sql: DICTATION_STATS_SQL,
  });
  // Filtered here rather than in SQL so the minute-by-minute cutoff does not
  // restart the live query; expired rows only linger until the hourly purge.
  const cutoff = retentionCutoff(retention, now.getTime());
  return {
    ...query,
    data: cutoff
      ? query.data?.filter((row) => row.created_at >= cutoff)
      : query.data,
    retention,
  };
}
