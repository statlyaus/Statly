/**
 * The NBA ingest jobs against PostgreSQL, fed by a synthetic in-memory provider (ESPN is never
 * contacted; the ESPN adapter's parsing is unit-tested). Proves the jobs persist teams, players,
 * the schedule and box scores; that re-ingesting box scores is idempotent and drops a player a
 * correction removed; and that a rejected injury report keeps the previous one. Every row this file
 * writes carries the provider id below or a Q-prefixed team code, and is removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import type {
  NbaProviderBoxScore,
  NbaProviderGame,
  NbaProviderInjury,
  NbaProviderPlayerLine,
  NbaStatsProvider,
} from '@/server/basketball/ingest/nbaStatsProvider';
import { NbaIngestRejected } from '@/server/basketball/ingest/nbaStatsProvider';
import { syncNbaBoxScores } from '@/server/basketball/ingest/syncNbaBoxScores';
import { syncNbaInjuries } from '@/server/basketball/ingest/syncNbaInjuries';
import { syncNbaPlayers } from '@/server/basketball/ingest/syncNbaPlayers';
import { syncNbaSchedule } from '@/server/basketball/ingest/syncNbaSchedule';

const PROVIDER = 'int-nba-ingest';
const SEASON = 2027;
const NOW = new Date('2026-11-08T12:00:00Z');
const TEAM_CODES = Array.from({ length: 30 }, (_, index) => `Q${String(index).padStart(2, '0')}`);
const ROSTER_SIZE = 15;
const GAME_COUNT = 1230;
const FINAL_GAMES = 5;

const playerId = (code: string, index: number) => `${PROVIDER}-${code}-${index}`;

// Game i: Q(i mod 30) hosts the next team, one game a day from 1 October 2026, so the season spans
// NOW and the first five games are long finished.
const games: NbaProviderGame[] = Array.from({ length: GAME_COUNT }, (_, index) => {
  const startsAt = new Date(Date.UTC(2026, 9, 1 + index, 23));
  return {
    externalId: `${PROVIDER}-game-${index}`,
    season: SEASON,
    startsAt,
    gameDate: startsAt.toISOString().slice(0, 10),
    homeTeamCode: TEAM_CODES[index % 30],
    awayTeamCode: TEAM_CODES[(index + 1) % 30],
    status: index < FINAL_GAMES ? 'FINAL' : 'SCHEDULED',
    homeScore: index < FINAL_GAMES ? 110 : null,
    awayScore: index < FINAL_GAMES ? 100 : null,
  };
});

function statLine(externalId: string, teamCode: string, points: number): NbaProviderPlayerLine {
  return {
    player: { externalId, fullName: `Box ${externalId}`, positions: ['F'] },
    teamCode,
    starter: false,
    played: true,
    dnpReason: null,
    secondsPlayed: 1200,
    points,
    rebounds: 5,
    offensiveRebounds: 1,
    defensiveRebounds: 4,
    assists: 3,
    steals: 1,
    blocks: 1,
    turnovers: 2,
    fieldGoalsMade: 4,
    fieldGoalsAttempted: 9,
    threePointersMade: 1,
    threePointersAttempted: 3,
    freeThrowsMade: 2,
    freeThrowsAttempted: 2,
    personalFouls: 3,
    plusMinus: -4,
  };
}

/** Ten rostered home players; nine rostered away players and one the provider never rostered. */
function boxScoreFor(externalId: string, homeListed = 10): NbaProviderBoxScore {
  const game = games.find((candidate) => candidate.externalId === externalId);
  if (!game) throw new NbaIngestRejected('fetch_failed', `no game ${externalId}`);
  return {
    game,
    lines: [
      ...Array.from({ length: homeListed }, (_, index) =>
        statLine(playerId(game.homeTeamCode, index), game.homeTeamCode, 10 + index)
      ),
      ...Array.from({ length: 9 }, (_, index) =>
        statLine(playerId(game.awayTeamCode, index), game.awayTeamCode, 5)
      ),
      {
        ...statLine(`${PROVIDER}-signed-${externalId}`, game.awayTeamCode, 0),
        played: false,
        dnpReason: 'COACH_DECISION',
        secondsPlayed: 0,
      },
    ],
    unidentifiedEmptyRows: 0,
  };
}

function injury(externalId: string, overrides: Partial<NbaProviderInjury> = {}): NbaProviderInjury {
  return {
    athleteExternalId: externalId,
    status: 'OUT',
    detail: 'Left Ankle',
    expectedReturnOn: '2026-11-20',
    reportedAt: new Date('2026-11-07T22:00:00Z'),
    comment: 'Player (ankle) is out for Friday.',
    fantasyStatus: 'OUT',
    seasonEnding: false,
    ...overrides,
  };
}

let injuryFeed: NbaProviderInjury[] = [];
let homeListed = 10;

const provider: NbaStatsProvider = {
  id: PROVIDER,
  commercialUseLicensed: true,
  fetchTeams: async () =>
    TEAM_CODES.map((code, index) => ({ externalId: String(index), code, name: `Team ${code}` })),
  fetchTeamRoster: async (teamExternalId) => {
    const code = TEAM_CODES[Number(teamExternalId)];
    return Array.from({ length: ROSTER_SIZE }, (_, index) => ({
      externalId: playerId(code, index),
      fullName: `Player ${code} ${index}`,
      firstName: 'Player',
      lastName: `${code} ${index}`,
      positions: ['G'],
      birthDate: '2000-01-15',
    }));
  },
  fetchTeamSchedule: async () => games,
  fetchScoreboard: async () => [],
  fetchBoxScore: async (externalId) => boxScoreFor(externalId, homeListed),
  fetchInjuries: async () => injuryFeed,
  fetchSeasonTotals: async () => [],
};

const options = { prisma, provider, season: SEASON, now: NOW };

async function cleanUp() {
  const identities = await prisma.nbaPlayerIdentity.findMany({
    where: { provider: PROVIDER },
    select: { playerId: true },
  });
  const playerIds = identities.map((identity) => identity.playerId);
  await prisma.nbaPlayerGameStat.deleteMany({ where: { game: { provider: PROVIDER } } });
  await prisma.nbaPlayerInjury.deleteMany({ where: { playerId: { in: playerIds } } });
  await prisma.nbaGame.deleteMany({ where: { provider: PROVIDER } });
  await prisma.nbaPlayerIdentity.deleteMany({ where: { provider: PROVIDER } });
  await prisma.nbaPlayer.deleteMany({ where: { id: { in: playerIds } } });
  await prisma.nbaTeam.deleteMany({ where: { code: { in: TEAM_CODES } } });
  await prisma.nbaIngestRun.deleteMany({ where: { provider: PROVIDER } });
}

async function statSnapshot() {
  const rows = await prisma.nbaPlayerGameStat.findMany({
    where: { game: { provider: PROVIDER } },
    select: { gameId: true, playerId: true, points: true, played: true, dnpReason: true },
    orderBy: [{ gameId: 'asc' }, { playerId: 'asc' }],
  });
  return rows;
}

describe('NBA ingest jobs (PostgreSQL)', () => {
  beforeAll(async () => {
    await cleanUp();
    await syncNbaPlayers(options);
    await syncNbaSchedule(options);
  });

  afterAll(cleanUp);

  it('stores the teams, rostered players by provider identity, and the schedule', async () => {
    await expect(prisma.nbaTeam.count({ where: { code: { in: TEAM_CODES } } })).resolves.toBe(30);
    await expect(prisma.nbaPlayerIdentity.count({ where: { provider: PROVIDER } })).resolves.toBe(
      30 * ROSTER_SIZE
    );
    await expect(prisma.nbaGame.count({ where: { provider: PROVIDER } })).resolves.toBe(GAME_COUNT);
    const game = await prisma.nbaGame.findUniqueOrThrow({
      where: { provider_externalId: { provider: PROVIDER, externalId: games[0].externalId } },
      include: { homeTeam: true, awayTeam: true },
    });
    expect(game).toMatchObject({ status: 'FINAL', homeScore: 110, boxScoreIngestedAt: null });
    expect([game.homeTeam.code, game.awayTeam.code]).toEqual(['Q00', 'Q01']);

    const repeat = await syncNbaSchedule(options);
    expect(repeat.summary).toMatchObject({ created: 0, updated: 0 });
  });

  it('ingests final box scores in bounded runs and creates unseen players', async () => {
    const first = await syncNbaBoxScores({ ...options, limits: { games: 3 } });
    expect(first.summary).toMatchObject({
      ingested: 3,
      playersCreated: 3,
      skipped: [],
      pending: 2,
    });

    const second = await syncNbaBoxScores(options);
    expect(second.summary).toMatchObject({ ingested: 2, playersCreated: 2, pending: 0 });

    const rows = await statSnapshot();
    expect(rows).toHaveLength(FINAL_GAMES * 20);
    expect(rows.filter((row) => !row.played)).toHaveLength(FINAL_GAMES);
    expect(rows.find((row) => !row.played)?.dnpReason).toBe('COACH_DECISION');

    const ingestedGames = await prisma.nbaGame.findMany({
      where: { provider: PROVIDER, boxScoreIngestedAt: { not: null } },
      select: { boxScoreIngestedAt: true, boxScoreFinalisedAt: true },
    });
    expect(ingestedGames).toHaveLength(FINAL_GAMES);
    // Ingested more than 24 hours after tip-off: already final, never re-fetched.
    expect(ingestedGames.every((game) => game.boxScoreFinalisedAt !== null)).toBe(true);

    const runs = await prisma.nbaIngestRun.findMany({
      where: { provider: PROVIDER, job: 'BOX_SCORES' },
      select: { outcome: true },
    });
    expect(runs).toEqual([{ outcome: 'SUCCEEDED' }, { outcome: 'SUCCEEDED' }]);
  });

  it('re-ingests idempotently and drops a player a correction removed', async () => {
    const before = await statSnapshot();
    const playersBefore = await prisma.nbaPlayerIdentity.count({ where: { provider: PROVIDER } });

    await prisma.nbaGame.updateMany({
      where: { provider: PROVIDER },
      data: { boxScoreIngestedAt: null, boxScoreFinalisedAt: null },
    });
    const repeat = await syncNbaBoxScores(options);

    expect(repeat.summary).toMatchObject({ ingested: FINAL_GAMES, playersCreated: 0 });
    const after = await statSnapshot();
    expect(after.map(({ gameId, playerId: id, points }) => [gameId, id, points])).toEqual(
      before.map(({ gameId, playerId: id, points }) => [gameId, id, points])
    );
    await expect(prisma.nbaPlayerIdentity.count({ where: { provider: PROVIDER } })).resolves.toBe(
      playersBefore
    );

    homeListed = 9;
    try {
      await prisma.nbaGame.update({
        where: { provider_externalId: { provider: PROVIDER, externalId: games[0].externalId } },
        data: { boxScoreIngestedAt: null },
      });
      await syncNbaBoxScores(options);
    } finally {
      homeListed = 10;
    }
    await expect(statSnapshot()).resolves.toHaveLength(FINAL_GAMES * 20 - 1);
  });

  it('replaces the injury report, and a rejected report keeps the previous one', async () => {
    injuryFeed = [
      injury(playerId(TEAM_CODES[0], 0), {
        expectedReturnOn: '2027-10-01',
        comment: 'Player has sustained a season-ending Achilles injury.',
        fantasyStatus: 'OFS',
        seasonEnding: true,
      }),
      ...Array.from({ length: 24 }, (_, index) => injury(playerId(TEAM_CODES[index + 1], 0))),
      injury('never-rostered-1'),
      injury('never-rostered-2'),
    ];
    const stored = await syncNbaInjuries(options);
    expect(stored.summary).toEqual({
      rows: 27,
      stored: 25,
      unknownPlayers: 2,
      duplicates: 0,
      inSeason: true,
    });
    const select = {
      playerId: true,
      status: true,
      expectedReturnOn: true,
      comment: true,
      fantasyStatus: true,
      seasonEnding: true,
      fetchedAt: true,
    } as const;
    const kept = await prisma.nbaPlayerInjury.findMany({ select, orderBy: { playerId: 'asc' } });
    expect(kept).toHaveLength(25);
    expect(kept.filter((row) => row.seasonEnding)).toEqual([
      expect.objectContaining({
        status: 'OUT',
        expectedReturnOn: new Date('2027-10-01T00:00:00Z'),
        comment: 'Player has sustained a season-ending Achilles injury.',
        fantasyStatus: 'OFS',
        fetchedAt: NOW,
      }),
    ]);
    expect(kept.find((row) => !row.seasonEnding)).toMatchObject({
      status: 'OUT',
      expectedReturnOn: new Date('2026-11-20T00:00:00Z'),
      comment: 'Player (ankle) is out for Friday.',
      fantasyStatus: 'OUT',
      fetchedAt: NOW,
    });

    injuryFeed = Array.from({ length: 401 }, (_, index) => injury(`flood-${index}`));
    await expect(
      syncNbaInjuries({ ...options, now: new Date('2026-11-08T13:00:00Z') })
    ).rejects.toMatchObject({ reason: 'out_of_bounds' });

    await expect(
      prisma.nbaPlayerInjury.findMany({ select, orderBy: { playerId: 'asc' } })
    ).resolves.toEqual(kept);
    const lastRun = await prisma.nbaIngestRun.findFirstOrThrow({
      where: { provider: PROVIDER, job: 'INJURIES' },
      orderBy: { startedAt: 'desc' },
    });
    expect(lastRun).toMatchObject({ outcome: 'REJECTED', reason: 'out_of_bounds' });
  });
});
