import { describe, expect, it, vi } from 'vitest';

const cacheCalls = vi.hoisted(() => [] as { key: string[]; options: unknown }[]);
vi.mock('next/cache', () => ({
  unstable_cache: (fn: () => Promise<unknown>, key: string[], options: unknown) => {
    cacheCalls.push({ key, options });
    // The data cache stores JSON: anything that does not survive a round trip would break.
    return async () => JSON.parse(JSON.stringify(await fn()));
  },
}));

import { leagueFixture, spot } from './__fixtures__/fakeNbaClient';
import { loadRotation, type RotationReadClient } from './rotationModel';

interface Game {
  id: string;
  season: number;
  status: 'FINAL' | 'SCHEDULED';
  gameDate: string;
}

interface Row {
  gameId: string;
  playerId: string;
  team: string;
  /** S30 started 30 minutes, B12 bench 12, CD / INJ did not play. */
  entry: string;
}

const games: Game[] = [
  { id: 'den1', season: 2027, status: 'FINAL', gameDate: '2026-10-28' },
  { id: 'den2', season: 2027, status: 'FINAL', gameDate: '2026-10-29' },
  { id: 'den3', season: 2027, status: 'FINAL', gameDate: '2026-10-30' },
  { id: 'den4', season: 2027, status: 'FINAL', gameDate: '2026-10-31' },
  { id: 'nyk1', season: 2027, status: 'FINAL', gameDate: '2026-10-30' },
  { id: 'nyk2', season: 2027, status: 'FINAL', gameDate: '2026-10-31' },
  // Last season and a game not yet final never count.
  { id: 'old', season: 2026, status: 'FINAL', gameDate: '2026-03-01' },
  { id: 'next', season: 2027, status: 'SCHEDULED', gameDate: '2026-11-03' },
];

function lineup(gameId: string, team: string, entries: Record<string, string>): Row[] {
  return Object.entries(entries).map(([playerId, entry]) => ({ gameId, playerId, team, entry }));
}

const START = { a: 'S30', b: 'S30', c: 'S30', d: 'S30' };
const NYK_FOUR = { n1: 'S30', n2: 'S30', n3: 'S30', n4: 'S30' };

const rows: Row[] = [
  // DEN: y moves into the five for e; z and o lose their minutes to coach's decisions.
  ...['den1', 'den2'].flatMap((id) =>
    lineup(id, 'DEN', { ...START, e: 'S30', y: 'B20', z: 'B15', o: 'B14' })
  ),
  ...['den3', 'den4'].flatMap((id) =>
    lineup(id, 'DEN', { ...START, y: 'S30', e: 'B20', z: 'CD', o: 'CD' })
  ),
  // NYK: free agent f starts for n5, who is injured; free agent h starts the game after a
  // coach's-decision DNP, which keeps him off the moving-up list.
  ...lineup('nyk1', 'NYK', { ...NYK_FOUR, n5: 'S30', f: 'B12', h: 'CD' }),
  ...lineup('nyk2', 'NYK', { ...NYK_FOUR, n4: 'B20', n5: 'INJ', f: 'S30', h: 'S30' }),
  ...lineup('old', 'DEN', { z: 'S40' }),
  ...lineup('next', 'DEN', { z: 'S40' }),
];

const names: Record<string, string> = {
  a: 'Al Able',
  b: 'Bo Baker',
  c: 'Cy Cole',
  d: 'Dan Dale',
  e: 'Ed Ellis',
  y: 'Yan Young',
  z: 'Zed Zane',
  o: 'Oz Oakes',
  n1: 'Nat One',
  n2: 'Ned Two',
  n3: 'Nik Three',
  n4: 'Noa Four',
  n5: 'Nate Fifth',
  f: 'Finn Free',
  h: 'Hal Hope',
};

function fakeClient(): RotationReadClient {
  const gameById = new Map(games.map((game) => [game.id, game]));
  const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
  const client = {
    nbaPlayerGameStat: {
      async findMany(args: {
        where: { game: { season: number; status: string } };
        select: Record<string, unknown>;
      }) {
        const { season, status } = args.where.game;
        expect(Object.keys(args.where)).toEqual(['game']);
        return rows
          .filter((row) => {
            const game = gameById.get(row.gameId)!;
            return game.season === season && game.status === status;
          })
          .map((row) => {
            const played = /^[SB]\d+$/.test(row.entry);
            return {
              gameId: row.gameId,
              playerId: row.playerId,
              starter: row.entry.startsWith('S'),
              played,
              dnpReason: played ? null : row.entry === 'CD' ? 'COACH_DECISION' : 'INJURY',
              secondsPlayed: played ? Number(row.entry.slice(1)) * 60 : 0,
              fieldGoalsMade: 0,
              fieldGoalsAttempted: 0,
              threePointersMade: 0,
              freeThrowsAttempted: 0,
              plusMinus: 0,
              game: { gameDate: date(gameById.get(row.gameId)!.gameDate) },
              team: { code: row.team },
            };
          });
      },
    },
    nbaPlayer: {
      async findMany(args: { where: { id: { in: string[] } } }) {
        return args.where.id.in.map((id) => ({
          id,
          fullName: names[id] ?? id,
          positions: ['G'],
          injury:
            id === 'n5'
              ? { status: 'OUT', detail: 'Ankle', expectedReturnOn: date('2026-11-20') }
              : null,
        }));
      },
    },
    nbaIngestRun: {
      async findFirst() {
        return { finishedAt: new Date('2026-11-01T12:00:00.000Z') };
      },
    },
  };
  return client as unknown as RotationReadClient;
}

const league = leagueFixture({
  rosterSpots: [
    spot('a', 'team-me'),
    spot('y', 'team-me'),
    spot('z', 'team-me'),
    spot('o', 'team-opp'),
    spot('e', 'team-other'),
    spot('n1', null),
  ],
  // Week 3 starts Mon 2 Nov.
  matchups: [{ week: 3, teamId: 'team-me', opponentTeamId: 'team-opp' }],
});

describe('loadRotation', () => {
  it('leads with alerts for my players and this week’s opponent’s, most serious first', async () => {
    const view = await loadRotation(league, { today: '2026-11-02', client: fakeClient() });

    expect(view.opponentName).toBe('Rivals');
    expect(view.alerts.mine.map((player) => [player.fullName, player.alert?.level])).toEqual([
      ['Zed Zane', 'RED'],
      ['Yan Young', 'GREEN'],
    ]);
    expect(view.alerts.opponent.map((player) => [player.fullName, player.alert?.text])).toEqual([
      ['Oz Oakes', 'DNP-CD 31 Oct'],
    ]);
  });

  it('lists free agents whose role grew, with the starter they cover for named', async () => {
    const view = await loadRotation(league, { today: '2026-11-02', client: fakeClient() });

    expect(view.freeAgentRoleUps.map((player) => [player.fullName, player.alert?.text])).toEqual([
      ['Finn Free', 'Starting for Fifth (back 20 Nov)'],
    ]);
    expect(view.players.find((player) => player.playerId === 'h')?.alert).toMatchObject({
      level: 'RED',
      roleUp: 'EARNED',
    });
  });

  it('labels who holds each player in this league and counts only this season’s final games', async () => {
    const view = await loadRotation(league, { today: '2026-11-02', client: fakeClient() });
    const byId = new Map(view.players.map((player) => [player.playerId, player]));

    expect(byId.get('a')?.owner).toEqual({ kind: 'MINE', teamName: 'My Team' });
    expect(byId.get('o')?.owner).toEqual({ kind: 'OPPONENT', teamName: 'Rivals' });
    expect(byId.get('e')?.owner).toEqual({ kind: 'TEAM', teamName: 'Others' });
    expect(byId.get('n1')?.owner).toEqual({ kind: 'ELSEWHERE', teamName: null });
    expect(byId.get('f')?.owner).toEqual({ kind: 'FREE_AGENT', teamName: null });
    expect(byId.get('n5')?.injury).toEqual({
      status: 'OUT',
      detail: 'Ankle',
      expectedReturnOn: '2026-11-20',
    });
    expect(byId.get('z')).toMatchObject({ gamesPlayed: 2, minutesPerGame: 15 });
    expect(view.players.map((player) => player.fullName)).toEqual(
      Object.values(names).sort((x, y) => x.localeCompare(y))
    );
    expect(view.statsUpdatedAt).toBe('2026-11-01T12:00:00.000Z');
  });

  it('names the players in each team’s last starting-five change', async () => {
    const view = await loadRotation(league, { today: '2026-11-02', client: fakeClient() });

    expect(view.teams.map((team) => [team.teamCode, team.lastChange])).toEqual([
      [
        'DEN',
        {
          gameDate: '2026-10-30',
          into: [{ playerId: 'y', name: 'Yan Young' }],
          out: [{ playerId: 'e', name: 'Ed Ellis', why: 'bench' }],
        },
      ],
      [
        'NYK',
        {
          gameDate: '2026-10-31',
          into: [
            { playerId: 'f', name: 'Finn Free' },
            { playerId: 'h', name: 'Hal Hope' },
          ],
          out: [
            { playerId: 'n4', name: 'Noa Four', why: 'bench' },
            { playerId: 'n5', name: 'Nate Fifth', why: 'injured' },
          ],
        },
      ],
    ]);
  });

  it('caches the season’s box scores until the next box-score ingest', async () => {
    await loadRotation(league, { today: '2026-11-02', client: fakeClient() });

    expect(cacheCalls.at(-1)).toEqual({
      key: ['basketball:rotation', '2027', '2026-11-01T12:00:00.000Z'],
      options: { revalidate: 300 },
    });
  });

  it('has no opponent alerts when no opponent is set this week', async () => {
    const view = await loadRotation(leagueFixture({ rosterSpots: league.rosterSpots }), {
      today: '2026-11-02',
      client: fakeClient(),
    });

    expect(view.opponentName).toBeNull();
    expect(view.alerts.opponent).toEqual([]);
    expect(view.players.find((player) => player.playerId === 'o')?.owner.kind).toBe('TEAM');
  });
});
