import { describe, expect, it } from 'vitest';

import {
  createFakeNbaClient,
  leagueFixture,
  spot,
  statRow,
  type FakeNbaData,
} from './__fixtures__/fakeNbaClient';
import { loadTrade, MAX_TRADE_PLAYERS } from './tradeModel';

const lines: Record<string, { points?: number; rebounds?: number }> = {
  a: { points: 30, rebounds: 2 },
  b: { points: 8, rebounds: 12 },
  x: { points: 20, rebounds: 4 },
  y: { points: 10, rebounds: 14 },
  f: { points: 14, rebounds: 6 },
};

function data(): FakeNbaData {
  return {
    teams: [{ id: 'BOS', code: 'BOS' }],
    players: Object.keys(lines).map((id) => ({
      id,
      fullName: id.toUpperCase(),
      positions: ['F'],
      teamId: 'BOS',
    })),
    games: [
      {
        id: 'g',
        season: 2026,
        gameDate: '2026-03-01',
        status: 'FINAL',
        homeTeamId: 'BOS',
        awayTeamId: 'BOS',
      },
    ],
    stats: Object.entries(lines).map(([id, line]) => statRow('g', id, 'BOS', line)),
  };
}

const league = leagueFixture({
  categories: ['PTS', 'REB'],
  puntCategories: ['REB'],
  rosterSpots: [spot('a', 'team-me'), spot('b', 'team-me'), spot('x', 'team-opp'), spot('y', null)],
});
const today = '2026-11-05';

describe('loadTrade', () => {
  it('offers my players to give and everyone else to get', async () => {
    const view = await loadTrade(league, {
      give: [],
      get: [],
      today,
      client: createFakeNbaClient(data()),
    });

    expect(view.myPlayers.map((player) => player.playerId).sort()).toEqual(['a', 'b']);
    expect(view.otherPlayers.map((player) => player.playerId).sort()).toEqual(['f', 'x', 'y']);
    expect(view.evaluation).toBeNull();
  });

  it('keeps only my players on the give side and only others on the get side', async () => {
    const view = await loadTrade(league, {
      give: ['a', 'x', 'nobody', 'a'],
      get: ['y', 'b', 'f'],
      today,
      client: createFakeNbaClient(data()),
    });

    expect(view.give.map((player) => player.playerId)).toEqual(['a']);
    expect(view.get.map((player) => player.playerId)).toEqual(['y', 'f']);
  });

  it('nets category z with the league punts marked and left out of the total', async () => {
    const view = await loadTrade(league, {
      give: ['a'],
      get: ['y'],
      today,
      client: createFakeNbaClient(data()),
    });
    const category = (id: string) => view.evaluation?.categories.find((c) => c.category === id);

    expect(category('PTS')).toMatchObject({ verdict: 'LOSS', punted: false });
    expect(category('REB')).toMatchObject({ verdict: 'GAIN', punted: true });
    expect(view.evaluation?.totalNet).toBeCloseTo(category('PTS')?.net ?? NaN);
    expect(view.evaluation?.summary).toEqual({ gains: 0, losses: 1, evens: 0 });
  });

  it('caps each side', async () => {
    const view = await loadTrade(league, {
      give: [],
      get: Array.from({ length: MAX_TRADE_PLAYERS + 3 }, () => ['x', 'y', 'f']).flat(),
      today,
      client: createFakeNbaClient(data()),
    });
    expect(view.get.length).toBeLessThanOrEqual(MAX_TRADE_PLAYERS);
  });
});
