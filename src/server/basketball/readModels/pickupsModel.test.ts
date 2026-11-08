import { describe, expect, it } from 'vitest';

import { YAHOO_DEFAULT_ROSTER_SLOTS } from '@/types/basketball';

import {
  createFakeNbaClient,
  leagueFixture,
  spot,
  statRow,
  type FakeGame,
  type FakeNbaData,
  type FakePlayer,
} from './__fixtures__/fakeNbaClient';
import { loadPickups } from './pickupsModel';

const teams = ['BOS', 'NYK', 'DEN', 'LAL', 'MIA', 'PHI'].map((code) => ({ id: code, code }));
const game = (
  id: string,
  gameDate: string,
  home: string,
  away: string,
  status: FakeGame['status'] = 'SCHEDULED'
): FakeGame => ({
  id,
  season: 2027,
  gameDate,
  status,
  homeTeamId: home,
  awayTeamId: away,
});

const players: (FakePlayer & { points: number; minutes?: number })[] = [
  { id: 'a', fullName: 'A', positions: ['G'], teamId: 'BOS', points: 30 },
  { id: 'b', fullName: 'B', positions: ['G'], teamId: 'BOS', points: 20 },
  { id: 'il', fullName: 'IL', positions: ['G'], teamId: 'NYK', points: 5 },
  { id: 'x', fullName: 'X', positions: ['G'], teamId: 'NYK', points: 15 },
  { id: 'el', fullName: 'Elsewhere', positions: ['F'], teamId: 'LAL', points: 35 },
  { id: 'o', fullName: 'Other', positions: ['F'], teamId: 'DEN', points: 33 },
  { id: 'f1', fullName: 'Free One', positions: ['F'], teamId: 'LAL', points: 25 },
  {
    id: 'f2',
    fullName: 'Free Two',
    positions: ['F'],
    teamId: 'DEN',
    points: 18,
    minutes: 20,
    injury: { status: 'DAY_TO_DAY' },
  },
  {
    id: 'f3',
    fullName: 'Free Out',
    positions: ['F'],
    teamId: 'DEN',
    points: 40,
    injury: { status: 'OUT' },
  },
  { id: 'f4', fullName: 'Free Bench', positions: ['F'], teamId: 'LAL', points: 22, minutes: 10 },
  // A weak streamer with a game left, and a strong player whose team's last game is today.
  { id: 'f5', fullName: 'Free Streamer', positions: ['G'], teamId: 'NYK', points: 2 },
  { id: 'f6', fullName: 'Free Idle', positions: ['F'], teamId: 'MIA', points: 28 },
];

function data(): FakeNbaData {
  return {
    teams,
    players,
    games: [
      game('last', '2026-03-01', 'BOS', 'NYK', 'FINAL'),
      // Week 3 (2–8 Nov). Today is Thu 5 Nov; adds count from Fri 6 Nov.
      game('thu', '2026-11-05', 'LAL', 'DEN'),
      game('fri', '2026-11-06', 'NYK', 'LAL'),
      game('sat', '2026-11-07', 'BOS', 'DEN'),
      game('sun', '2026-11-08', 'LAL', 'DEN'),
      game('thu2', '2026-11-05', 'MIA', 'PHI'),
    ].map((g) => (g.id === 'last' ? { ...g, season: 2026 } : g)),
    stats: players.map((player) =>
      statRow('last', player.id, player.teamId ?? 'BOS', {
        points: player.points,
        secondsPlayed: (player.minutes ?? 30) * 60,
      })
    ),
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
    spot('il', 'team-me', { onInjuredList: true }),
    spot('x', 'team-opp'),
    spot('el', null),
    spot('o', 'team-other'),
  ],
  matchups: [{ week: 3, teamId: 'team-me', opponentTeamId: 'team-opp' }],
});
const today = '2026-11-05';

describe('loadPickups', () => {
  it('ranks healthy or day-to-day free agents above the minutes floor against the default drop', async () => {
    const view = await loadPickups(league, { today, client: createFakeNbaClient(data()) });
    if (view.status !== 'READY') throw new Error('expected pickups');

    // f6's team has no game once the add takes effect; f3 is out; f4 is under 15 minutes.
    expect(view.options.map((option) => option.player.playerId).sort()).toEqual(['f1', 'f2', 'f5']);
    // The lowest-valued player not on the IL.
    expect(view.drop?.playerId).toBe('b');
    expect(view.dropOptions.map((option) => option.playerId)).toEqual(['a', 'b', 'il']);
    expect(view.addFrom).toBe('2026-11-06');
    expect(view.opponentTeam.name).toBe('Rivals');
  });

  it('counts an add’s games from tomorrow', async () => {
    const view = await loadPickups(league, { today, client: createFakeNbaClient(data()) });
    if (view.status !== 'READY') throw new Error('expected pickups');

    // LAL plays Thu, Fri and Sun; Thursday is today, before the add takes effect.
    expect(view.options.find((option) => option.player.playerId === 'f1')?.gamesAdded).toBe(2);
  });

  it('ranks every free agent with a game left, capping only the no-opponent list', async () => {
    const client = createFakeNbaClient(data());
    const capped = await loadPickups(league, { today, client, limit: 1 });
    const strict = await loadPickups(league, { today, client, minMinutes: 25 });
    if (capped.status !== 'READY' || strict.status !== 'READY') throw new Error('expected pickups');

    // The weakest free agent still reaches the weekly ranking.
    expect(capped.options.map((option) => option.player.playerId).sort()).toEqual([
      'f1',
      'f2',
      'f5',
    ]);
    expect(strict.options.map((option) => option.player.playerId).sort()).toEqual(['f1', 'f5']);
  });

  it('drops the chosen player, nobody, or falls back when the choice is not mine', async () => {
    const client = createFakeNbaClient(data());
    const chosen = await loadPickups(league, { today, client, drop: 'a' });
    const nobody = await loadPickups(league, { today, client, drop: null });
    const notMine = await loadPickups(league, { today, client, drop: 'x' });

    expect(chosen.drop?.playerId).toBe('a');
    expect(nobody.drop).toBeNull();
    expect(notMine.drop?.playerId).toBe('b');
  });

  it('lists free agents by season value when no opponent is set this week', async () => {
    const view = await loadPickups(
      { ...league, matchups: [] },
      { today, client: createFakeNbaClient(data()) }
    );

    expect(view.status).toBe('NO_OPPONENT');
    if (view.status !== 'NO_OPPONENT') return;
    expect(view.freeAgents.map((player) => player.playerId)).toEqual(['f6', 'f1', 'f2', 'f5']);
    const capped = await loadPickups(
      { ...league, matchups: [] },
      { today, client: createFakeNbaClient(data()), limit: 2 }
    );
    if (capped.status !== 'NO_OPPONENT') return;
    expect(capped.freeAgents.map((player) => player.playerId)).toEqual(['f6', 'f1']);
  });
});
