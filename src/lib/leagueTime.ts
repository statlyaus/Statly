/**
 * League-scheduled times (draft starts, lineup locks, matchup starts, waiver runs, picks) are shown
 * in the league's own timezone with its abbreviation, never silently in the viewer's zone.
 */
const LEAGUE_TIME_OPTIONS = {
  full: { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' },
  time: { hour: 'numeric', minute: '2-digit' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

/** Format an instant in the league's timezone, e.g. "Sat, 3 Oct, 7:30 pm AEST" or "7:30 pm AEST". */
export function formatLeagueTime(
  value: string | Date,
  timeZone: string | undefined,
  style: keyof typeof LEAGUE_TIME_OPTIONS = 'full'
): string {
  const date = new Date(value);
  const options: Intl.DateTimeFormatOptions = {
    ...LEAGUE_TIME_OPTIONS[style],
    timeZoneName: 'short',
  };
  try {
    return new Intl.DateTimeFormat('en-AU', { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-AU', { ...options, timeZone: 'UTC' }).format(date);
  }
}
