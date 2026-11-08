import { describe, expect, it } from 'vitest';

import {
  aflGrandFinalDate,
  defaultLeagueSeasonYear,
  leagueSeasonData,
} from '@/server/leagues/seasonYear';

describe('league season year', () => {
  it.each([
    [2026, '2026-09-26'],
    [2027, '2027-09-25'],
    [2028, '2028-09-30'],
  ])('puts the %s Grand Final on the last Saturday of September', (year, date) => {
    expect(aflGrandFinalDate(year)).toBe(date);
  });

  it.each([
    ['in the middle of the season', '2026-07-29T06:00:00.000Z', 2026],
    ['on Grand Final day in Melbourne', '2026-09-26T12:00:00.000Z', 2026],
    ['the day after the Grand Final in Melbourne', '2026-09-26T14:30:00.000Z', 2027],
    ['in November', '2026-11-08T00:00:00.000Z', 2027],
    ['in the new year', '2027-01-10T00:00:00.000Z', 2027],
  ])('defaults a league created %s', (_label, at, year) => {
    expect(defaultLeagueSeasonYear(new Date(at))).toBe(year);
  });

  it('describes the season as its calendar year', () => {
    expect(leagueSeasonData(2027)).toEqual({
      label: '2027 season',
      year: 2027,
      startsAt: new Date('2027-01-01T00:00:00.000Z'),
      endsAt: new Date('2027-12-31T23:59:59.999Z'),
    });
  });
});
