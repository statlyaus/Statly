// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isNbaIngestJobName, nbaSeasonForDate } from './nbaIngestJobs';

describe('nbaSeasonForDate', () => {
  it.each([
    ['2026-11-08T12:00:00Z', 2027],
    ['2027-04-12T12:00:00Z', 2027],
    ['2027-06-30T12:00:00Z', 2027],
    // 1 July 02:00 UTC is still 30 June in New York.
    ['2027-07-01T02:00:00Z', 2027],
    ['2027-07-01T12:00:00Z', 2028],
  ])('puts %s in season %i', (instant, season) => {
    expect(nbaSeasonForDate(new Date(instant))).toBe(season);
  });
});

describe('isNbaIngestJobName', () => {
  it('accepts the four jobs and nothing else', () => {
    expect(['boxscores', 'schedule', 'players', 'injuries'].every(isNbaIngestJobName)).toBe(true);
    expect(['backfill', 'toString', '', null].some(isNbaIngestJobName)).toBe(false);
  });
});
