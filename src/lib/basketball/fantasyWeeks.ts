/**
 * US Eastern game dates and fantasy weeks for fantasy basketball.
 *
 * Every date here is a `YYYY-MM-DD` string for a US Eastern calendar date: NBA game days and fantasy
 * weeks both count Eastern dates. Fantasy week `n` is the seven dates starting
 * `weekOneStartsOn + 7 × (n − 1)`. Pure and isomorphic: safe in client components.
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
  return EASTERN_DATE_FORMAT.format(instant);
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

/**
 * The fantasy week containing `date`. Dates before week one belong to week 1, as they do on Yahoo
 * before the season starts.
 */
export function fantasyWeekOf(date: EasternDate, weekOneStartsOn: EasternDate): number {
  const offset = daysBetween(weekOneStartsOn, date);
  return offset < 0 ? 1 : Math.floor(offset / 7) + 1;
}

export interface FantasyWeekRange {
  week: number;
  start: EasternDate;
  end: EasternDate;
  dates: EasternDate[];
}

export function fantasyWeekRange(week: number, weekOneStartsOn: EasternDate): FantasyWeekRange {
  if (!Number.isInteger(week) || week < 1) throw new Error(`Invalid fantasy week: ${week}`);
  const start = addDays(weekOneStartsOn, 7 * (week - 1));
  const dates = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  return { week, start, end: dates[6], dates };
}

/** The last fantasy week that starts on or before the regular season's final date. */
export function lastFantasyWeek(
  weekOneStartsOn: EasternDate,
  regularSeasonEndsOn: EasternDate
): number {
  return fantasyWeekOf(regularSeasonEndsOn, weekOneStartsOn);
}
