// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { compareSeasonTotals } from './backfillNbaSeason';
import type { NbaProviderSeasonTotal } from './nbaStatsProvider';

const brunson: NbaProviderSeasonTotal = {
  athleteExternalId: '3934672',
  fullName: 'Jalen Brunson',
  gamesPlayed: 70,
  minutes: 2450,
  points: 1960,
  rebounds: 210,
  assists: 480,
};

describe('compareSeasonTotals', () => {
  it('passes when the stored sums match the provider totals', () => {
    const stored = new Map([['3934672', { points: 1960, rebounds: 210, assists: 480 }]]);
    expect(compareSeasonTotals([brunson], stored)).toEqual([]);
  });

  it('reports each stat that differs, e.g. an NBA Cup final that slipped in', () => {
    const stored = new Map([['3934672', { points: 1985, rebounds: 216, assists: 480 }]]);

    expect(compareSeasonTotals([brunson], stored)).toEqual([
      {
        athleteExternalId: '3934672',
        fullName: 'Jalen Brunson',
        stat: 'points',
        provider: 1960,
        stored: 1985,
      },
      {
        athleteExternalId: '3934672',
        fullName: 'Jalen Brunson',
        stat: 'rebounds',
        provider: 210,
        stored: 216,
      },
    ]);
  });

  it('accepts differences within the tolerance and no larger', () => {
    // ESPN's 2026-27 season-totals feed is one assist off its own box scores for two players.
    const offByOne = new Map([['3934672', { points: 1960, rebounds: 210, assists: 481 }]]);
    const offByTwo = new Map([['3934672', { points: 1960, rebounds: 210, assists: 482 }]]);

    expect(compareSeasonTotals([brunson], offByOne, 1)).toEqual([]);
    expect(compareSeasonTotals([brunson], offByTwo, 1)).toHaveLength(1);
    expect(compareSeasonTotals([brunson], offByOne)).toHaveLength(1);
  });

  it('counts a player with no stored rows as zero', () => {
    expect(compareSeasonTotals([brunson], new Map())).toHaveLength(3);
  });
});
