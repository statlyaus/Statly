import { describe, expect, it } from 'vitest';

import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { buildTradeVerdict, squadPositionImpact, standoutStat } from './tradeVerdict';

const dataset: LeaguePlayerStatDatasetDto = {
  context: {
    basis: 'PER_GAME',
    period: 'SEASON',
    season: 2026,
    availableSeasons: [2026],
    dataThrough: null,
  },
  columns: [
    { key: 'goals', label: 'Goals', shortLabel: 'G', format: 'number', direction: 'HIGH_WINS' },
    { key: 'tackles', label: 'Tackles', shortLabel: 'T', format: 'number', direction: 'HIGH_WINS' },
    { key: 'kicks', label: 'Kicks', shortLabel: 'K', format: 'number', direction: 'HIGH_WINS' },
  ],
  playersById: {
    forward: { gamesPlayed: 10, values: { goals: 3, tackles: 2, kicks: 10 } },
    back: { gamesPlayed: 10, values: { goals: 0.2, tackles: 3, kicks: 14 } },
    mid: { gamesPlayed: 10, values: { goals: 1, tackles: 6, kicks: 12 } },
  },
};

describe('buildTradeVerdict', () => {
  it('says which way the trade tips from your side', () => {
    const verdict = buildTradeVerdict(['back'], ['forward'], dataset);
    expect(verdict).toMatchObject({ tone: 'bad', gained: 1, lost: 2, counted: 3 });
    expect(verdict.headline).toBe('You lose 2 of 3 categories');
    expect(verdict.short).toBe('Loses 2 of 3');

    const flipped = buildTradeVerdict(['forward'], ['back'], dataset);
    expect(flipped.headline).toBe('You win 2 of 3 categories');
    expect(flipped.tone).toBe('good');
  });

  it('waits for both sides before giving a verdict', () => {
    expect(buildTradeVerdict([], ['forward'], dataset)).toMatchObject({
      tone: 'unknown',
      short: 'No verdict',
    });
  });
});

describe('standoutStat', () => {
  it("picks the category a player is furthest above the league's average in", () => {
    expect(standoutStat('forward', dataset)).toMatchObject({ label: 'Goals', shortLabel: 'G' });
    expect(standoutStat('mid', dataset)).toMatchObject({ label: 'Tackles' });
    expect(standoutStat('nobody', dataset)).toBeNull();
  });
});

describe('squadPositionImpact', () => {
  it('counts dual-position players for each position they can play', () => {
    const squad = [
      { id: 'a', position: 'DEF' },
      { id: 'b', position: 'DEF/MID' },
      { id: 'c', position: 'FWD' },
    ];
    expect(
      squadPositionImpact(squad, [{ id: 'b', position: 'DEF/MID' }], [{ id: 'z', position: 'FWD' }])
    ).toEqual([
      { position: 'DEF', before: 2, after: 1 },
      { position: 'MID', before: 1, after: 0 },
      { position: 'FWD', before: 1, after: 2 },
    ]);
    expect(
      squadPositionImpact(squad, [{ id: 'a', position: 'DEF' }], [{ id: 'y', position: 'DEF' }])
    ).toEqual([]);
  });
});
