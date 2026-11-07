import { describe, expect, it } from 'vitest';

import { YAHOO_DEFAULT_ROSTER_SLOTS } from '@/types/basketball';

import {
  createFakeNbaClient,
  leagueFixture,
  spot,
  statRow,
  type FakeGame,
  type FakeNbaData,
} from './__fixtures__/fakeNbaClient';
import { loadMatchup } from './matchupModel';

const teams = ['BOS', 'NYK', 'DEN', 'LAL'].map((code) => ({ id: code, code }));
const game = (
  id: string,
  gameDate: string,
  home: string,
  away: string,
  status: FakeGame['status'] = 'SCHEDULED',
  season = 2027
): FakeGame => ({ id, season, gameDate, status, homeTeamId: home, awayTeamId: away });

/** Points per game, the same last season and this season, so projections are exact. */
const ppg: Record<string, number> = { a: 30, b: 20, c: 50, d: 1, e: 10, x: 15, y: 12, z: 40 };
const teamOf: Record<string, string> = {
  a: 'BOS',
  b: 'BOS',
  c: 'NYK',
  d: 'DEN',
  e: 'LAL',
  x: 'NYK',
  y: 'LAL',
  z: 'BOS',
};

function data(): FakeNbaData {
  const played: Record<string, string[]> = {
    mon: ['a', 'b', 'c', 'x', 'z'],
    wed: ['e', 'y'],
    thu: ['a', 'b', 'd', 'z'],
  };
  return {
    teams,
    players: Object.keys(ppg).map((id) => ({
      id,
      fullName: id.toUpperCase(),
      positions: ['F'],
      teamId: teamOf[id],
      injury: id === 'd' ? { status: 'OUT' as const } : undefined,
    })),
    games: [
      game('mon', '2026-11-02', 'BOS', 'NYK', 'FINAL'),
      game('wed', '2026-11-04', 'DEN', 'LAL', 'FINAL'),
      game('thu', '2026-11-05', 'BOS', 'DEN', 'FINAL'),
      game('fri', '2026-11-06', 'NYK', 'LAL'),
      game('sat', '2026-11-07', 'BOS', 'LAL'),
      game('sun', '2026-11-08', 'DEN', 'LAL'),
      game('last', '2026-03-01', 'BOS', 'NYK', 'FINAL', 2026),
    ],
    stats: [
      ...Object.entries(played).flatMap(([gameId, ids]) =>
        ids.map((id) => statRow(gameId, id, teamOf[id], { points: ppg[id] }))
      ),
      ...Object.keys(ppg).map((id) => statRow('last', id, teamOf[id], { points: ppg[id] })),
    ],
  };
}

const league = leagueFixture({
  rosterSlots: {
    ...YAHOO_DEFAULT_ROSTER_SLOTS,
    PG: 0,
    SG: 0,
    G: 0,
    SF: 0,
    PF: 0,
    F: 0,
    C: 0,
    UTIL: 2,
  },
  rosterSpots: [
    spot('a', 'team-me'),
    spot('b', 'team-me'),
    spot('c', 'team-me', { onInjuredList: true }),
    spot('d', 'team-me'),
    spot('e', 'team-me', { acquiredOn: '2026-11-06' }),
    spot('x', 'team-opp'),
    spot('y', 'team-opp'),
    spot('z', 'team-other'),
  ],
  matchups: [{ week: 3, teamId: 'team-me', opponentTeamId: 'team-opp' }],
});

describe('loadMatchup', () => {
  it('counts actuals on played dates and projects the rest of the week for both sides', async () => {
    const view = await loadMatchup(league, {
      today: '2026-11-05',
      client: createFakeNbaClient(data()),
    });
    if (view.status !== 'READY') throw new Error('expected a matchup');

    expect(view.week).toBe(3);
    expect(view.opponentTeam).toEqual({ id: 'team-opp', name: 'Rivals' });
    // Mon and Thu: a and b fill both slots; c is on the IL; d is benched; e was not yet held on Wed.
    expect(view.projection.me.actual.points).toBe(100);
    // Fri e; Sat a and b (e loses the slot on value); Sun e (d is OUT).
    expect(view.projection.me.restOfWeek.points).toBeCloseTo(70);
    expect(view.projection.opponent.actual.points).toBe(27);
    expect(view.projection.opponent.restOfWeek.points).toBeCloseTo(51);

    const row = (id: string) => view.me.players.find((player) => player.playerId === id);
    expect(row('a')).toMatchObject({ countedSoFar: 2, countedLeft: 1, teamGamesLeft: 1 });
    expect(row('a')?.actual.points).toBe(60);
    expect(row('a')?.restOfWeek.points).toBeCloseTo(30);
    expect(row('c')).toMatchObject({ countedSoFar: 0, countedLeft: 0, onInjuredList: true });
    expect(row('d')).toMatchObject({ countedSoFar: 0, countedLeft: 0 });
    expect(row('e')).toMatchObject({ countedSoFar: 0, countedLeft: 2, teamGamesLeft: 3 });
  });

  it('keeps each side to its own roster', async () => {
    const view = await loadMatchup(league, {
      today: '2026-11-05',
      client: createFakeNbaClient(data()),
    });
    if (view.status !== 'READY') throw new Error('expected a matchup');

    expect(view.me.players.map((player) => player.playerId).sort()).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
    expect(view.opponent.players.map((player) => player.playerId).sort()).toEqual(['x', 'y']);
  });

  it('defaults to the current week and reports a missing opponent', async () => {
    const view = await loadMatchup(league, {
      today: '2026-11-10',
      client: createFakeNbaClient(data()),
    });

    expect(view.status).toBe('NO_OPPONENT');
    expect(view.week).toBe(4);
    expect(view.lastWeek).toBe(25);
  });

  it('clamps a requested week to the season', async () => {
    const client = createFakeNbaClient(data());
    const early = await loadMatchup(league, { week: 0, today: '2026-11-05', client });
    const late = await loadMatchup(league, { week: 99, today: '2026-11-05', client });

    expect(early.week).toBe(1);
    expect(late.week).toBe(25);
  });
});
