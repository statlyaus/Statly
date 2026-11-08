// Which AFL season a league plays, and when the commissioner may change it.
//
// A league created after the AFL Grand Final has nothing left to play that year, so it defaults to
// next season. The Grand Final is taken as the last Saturday of September, Melbourne time; Statly
// holds no finals fixture to read it from (the fixture ingest writes numbered rounds only).

const LEAGUE_TIME_ZONE = 'Australia/Melbourne';

export const SEASON_CHANGE_LOCKED_MESSAGE =
  'The season can only change while the competition is in setup.';

/** The Grand Final date (YYYY-MM-DD) of an AFL season. */
export function aflGrandFinalDate(year: number): string {
  const lastOfSeptember = new Date(Date.UTC(year, 8, 30));
  const daysSinceSaturday = (lastOfSeptember.getUTCDay() + 1) % 7;
  return new Date(Date.UTC(year, 8, 30 - daysSinceSaturday)).toISOString().slice(0, 10);
}

function melbourneDate(at: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: LEAGUE_TIME_ZONE }).format(at);
}

/** The season a league created (or drafting) at this instant plays by default. */
export function defaultLeagueSeasonYear(at: Date): number {
  const date = melbourneDate(at);
  const year = Number(date.slice(0, 4));
  return date > aflGrandFinalDate(year) ? year + 1 : year;
}

export function leagueSeasonData(year: number) {
  return {
    label: `${year} season`,
    year,
    startsAt: new Date(Date.UTC(year, 0, 1)),
    endsAt: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
  };
}

/** A season a commissioner may choose: 2000 up to the season after the default one. */
export function isSelectableSeasonYear(year: unknown, now: Date): year is number {
  return (
    typeof year === 'number' &&
    Number.isInteger(year) &&
    year >= 2000 &&
    year <= defaultLeagueSeasonYear(now) + 1
  );
}
