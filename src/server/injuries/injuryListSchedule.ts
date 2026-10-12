/** The injury list is fetched from 1 January to 7 October, Melbourne time (owner decision 2026-10-11). */
export const INJURY_LIST_TIME_ZONE = 'Australia/Melbourne';
export const INJURY_LIST_LAST_MONTH = 10;
export const INJURY_LIST_LAST_DAY = 7;

// The scheduler runs on a fixed UTC cadence all year, so the season window is applied here: outside
// it a run does no fetch and writes nothing, and the last in-season snapshot stays current until
// it ages out of the read model's freshness window.
export function isInjuryListSeason(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: INJURY_LIST_TIME_ZONE,
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return (
    month < INJURY_LIST_LAST_MONTH ||
    (month === INJURY_LIST_LAST_MONTH && day <= INJURY_LIST_LAST_DAY)
  );
}
