import { Plural, Trans, useLingui } from "@lingui/react/macro";

import { summarizeDictations } from "./dictation";
import { useDictationStats } from "./dictation-queries";
import { StatCard } from "./stat-card";

import { useNow, useTimezone } from "~/shared/hooks/useNow";

export function DictationSection() {
  const { t, i18n } = useLingui();
  const query = useDictationStats();
  const now = useNow();
  const timezone = useTimezone();
  const rows = query.data ?? [];
  const stats = summarizeDictations(rows, now, timezone);
  const number = new Intl.NumberFormat(i18n.locale);
  const metrics = [
    {
      label: t`Dictations`,
      value: number.format(stats.dictations),
      span: "min-[480px]:col-span-2",
    },
    {
      label: t`Words`,
      value: number.format(stats.words),
      span: "min-[480px]:col-span-2",
    },
    {
      label: t`Words per minute`,
      value:
        stats.wordsPerMinute === null
          ? "—"
          : number.format(stats.wordsPerMinute),
      span: "min-[480px]:col-span-2",
    },
    {
      label: t`Day streak`,
      value: number.format(stats.streakDays),
      span: "min-[480px]:col-span-3",
    },
    {
      label: t`Days with dictations`,
      value: number.format(stats.activeDays),
      span: "min-[480px]:col-span-3",
    },
  ];

  return (
    <section className="flex flex-col gap-5" aria-label={t`Dictation`}>
      <h3 className="text-sm font-medium">
        <Trans>Dictation</Trans>
      </h3>
      {query.error ? (
        <p role="alert" className="text-muted-foreground text-sm">
          <Trans>
            Couldn't load your dictation statistics. Reopen this page to try
            again.
          </Trans>
        </p>
      ) : query.isLoading || !query.data ? (
        <p role="status" className="text-muted-foreground text-sm">
          <Trans>Loading your dictation statistics…</Trans>
        </p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {query.retention === "off" ? (
            <Trans>
              Dictation history is off. Turn it on in Settings &gt; Dictation
              history to see statistics here.
            </Trans>
          ) : (
            <Trans>
              No saved dictations yet. Statistics appear here once you dictate.
            </Trans>
          )}
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-6">
            {metrics.map((metric) => (
              <StatCard
                key={metric.label}
                label={metric.label}
                value={metric.value}
                className={metric.span}
              />
            ))}
          </dl>
          {stats.topApps.length > 0 && (
            <section
              className="flex flex-col gap-3"
              aria-label={t`Most-used apps`}
            >
              <h4 className="text-muted-foreground text-xs">
                <Trans>Most-used apps</Trans>
              </h4>
              <ol className="bg-card shadow-raised flex flex-col rounded-lg">
                {stats.topApps.map((app, index) => (
                  <li
                    key={`${index}:${app.name}`}
                    className="border-border flex items-center gap-3 border-b px-4 py-2.5 text-sm last:border-b-0"
                  >
                    <span className="text-muted-foreground w-4 tabular-nums">
                      {number.format(index + 1)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{app.name}</span>
                    <span className="text-muted-foreground tabular-nums">
                      <Plural
                        value={app.count}
                        one="# dictation"
                        other="# dictations"
                      />
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <p className="text-muted-foreground text-xs">
            {query.retention === "off" ? (
              <Trans>
                These figures cover only the dictations still saved. Dictation
                history is off, so new dictations are not counted.
              </Trans>
            ) : query.retention === "day" ? (
              <Trans>
                These figures cover only the dictations Librelog keeps: those
                from the last day.
              </Trans>
            ) : query.retention === "week" ? (
              <Trans>
                These figures cover only the dictations Librelog keeps: those
                from the last 7 days.
              </Trans>
            ) : query.retention === "month" ? (
              <Trans>
                These figures cover only the dictations Librelog keeps: those
                from the last 30 days.
              </Trans>
            ) : (
              <Trans>
                These figures cover every dictation Librelog keeps, until you
                delete it.
              </Trans>
            )}
          </p>
        </>
      )}
    </section>
  );
}
