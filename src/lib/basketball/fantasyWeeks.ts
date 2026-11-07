/**
 * US Eastern game dates and fantasy weeks for fantasy basketball.
 *
 * Every date here is a `YYYY-MM-DD` string for a US Eastern calendar date: NBA game days and fantasy
 * weeks both count Eastern dates. Fantasy weeks are seven dates long, except weeks listed in
 * `twoWeekMatchups`, which span fourteen (e.g. the All-Star break). Pure and isomorphic: safe in client
 * components.
 */

export type EasternDate = string;

const EASTERN_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The US Eastern calendar date of an instant. */
export function toEasternDate(instant: Date): EasternDate {
  const parts = EASTERN_DATE_FORMAT.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** A Prisma `@db.Date` value (UTC midnight) as a `YYYY-MM-DD` string. */
export function dateOnlyToString(value: Date): EasternDate {
  return value.toISOString().slice(0, 10);
}

/** A `YYYY-MM-DD` string as the UTC-midnight Date Prisma expects for `@db.Date`. */
export function stringToDateOnly(value: EasternDate): Date {
  assertEasternDate(value);
  return new Date(`${value}T00:00:00.000Z`);
}

export function isEasternDate(value: unknown): value is EasternDate {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function assertEasternDate(value: EasternDate): void {
  if (!isEasternDate(value)) throw new Error(`Invalid date: ${value}`);
}

export function addDays(date: EasternDate, days: number): EasternDate {
  const next = stringToDateOnly(date);
  next.setUTCDate(next.getUTCDate() + days);
  return dateOnlyToString(next);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: EasternDate, to: EasternDate): number {
  return Math.round(
    (stringToDateOnly(to).getTime() - stringToDateOnly(from).getTime()) / 86_400_000
  );
}

const MAX_FANTASY_WEEKS = 60;

function weekLength(week: number, twoWeekMatchups: readonly number[]): number {
  return twoWeekMatchups.includes(week) ? 14 : 7;
}

/**
 * The fantasy week containing `date`. Dates before week one belong to week 1, as they do on Yahoo
 * before the season starts.
 */
export function fantasyWeekOf(
  date: EasternDate,
  weekOneStartsOn: EasternDate,
  twoWeekMatchups: readonly number[] = []
): number {
  let offset = daysBetween(weekOneStartsOn, date);
  if (offset < 0) return 1;
  for (let week = 1; week < MAX_FANTASY_WEEKS; week += 1) {
    const length = weekLength(week, twoWeekMatchups);
    if (offset < length) return week;
    offset -= length;
  }
  return MAX_FANTASY_WEEKS;
}

export interface FantasyWeekRange {
  week: number;
  start: EasternDate;
  end: EasternDate;
  dates: EasternDate[];
}

export function fantasyWeekRange(
  week: number,
  weekOneStartsOn: EasternDate,
  twoWeekMatchups: readonly number[] = []
): FantasyWeekRange {
  if (!Number.isInteger(week) || week < 1 || week > MAX_FANTASY_WEEKS) {
    throw new Error(`Invalid fantasy week: ${week}`);
  }
  let start = weekOneStartsOn;
  for (let earlier = 1; earlier < week; earlier += 1) {
    start = addDays(start, weekLength(earlier, twoWeekMatchups));
  }
  const dates = Array.from({ length: weekLength(week, twoWeekMatchups) }, (_, index) =>
    addDays(start, index)
  );
  return { week, start, end: dates[dates.length - 1], dates };
}

/** The fantasy week containing the regular season's final date. */
export function lastFantasyWeek(
  weekOneStartsOn: EasternDate,
  regularSeasonEndsOn: EasternDate,
  twoWeekMatchups: readonly number[] = []
): number {
  return fantasyWeekOf(regularSeasonEndsOn, weekOneStartsOn, twoWeekMatchups);
}
