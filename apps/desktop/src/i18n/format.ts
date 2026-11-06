const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

// Replaces date-fns formatDistanceToNow, whose output is always English.
export function formatRelativeToNow(
  date: Date,
  locale: string,
  now: Date = new Date(),
): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  for (const [unit, unitSeconds] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= unitSeconds) {
      return formatter.format(Math.round(seconds / unitSeconds), unit);
    }
  }

  return formatter.format(0, "minute");
}

// Replaces date-fns "MMM d" / "MMM d, yyyy", whose month names are English.
export function formatMonthDay(
  date: Date,
  locale: string,
  options: { year?: boolean; timeZone?: string } = {},
): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(options.year ? { year: "numeric" as const } : {}),
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(date);
}
