/**
 * A player whose AFL game has started this round cannot be dropped or traded until the round ends,
 * and a player who leaves a roster leaves that member's open lineups with him (process-map finding
 * transactions-05). Run against PostgreSQL because the lineup cleanup filters on relations.
 */
import type { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Round 2 (AFL round 2): Carlton played Friday night, Geelong plays Sunday afternoon.
vi.mock('@/server/etl/etlRoundData', () => ({
  getRoundMatchesResult: vi.fn(async (season: number, round: number) => ({
    ok: true,
    matches:
      season === 2026 && round === 2
        ? [
            {
              home_team: 'Carlton',
              away_team: 'Collingwood',
              start_time_utc: '2026-07-17T09:30:00.000Z',
            },
            {
              home_team: 'Geelong',
              away_team: 'Hawthorn',
              start_time_utc: '2026-07-19T04:00:00.000Z',
            },
          ]
        : [],
  })),
  getRoundMatches: vi.fn().mockResolvedValue([]),
  getRoundPlayerStatsResult: vi.fn().mockResolvedValue({ ok: true, stats: [] }),
}));
const auth = vi.hoisted(() => ({ userId: '' }));
vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId: vi.fn(async () => auth.userId) }));
vi.mock('@/lib/leagueMembership', () => ({
  verifyLeagueMembership: vi.fn().mockResolvedValue({ isMember: true }),
}));
vi.mock('@/server/waivers/WaiverAvailabilityProjectionService', () => ({
  WaiverAvailabilityProjectionService: vi.fn(function () {
    return { projectLeague: vi.fn() };
  }),
}));

import { POST } from '@/app/api/leagues/[id]/actions/[userId]/route';
import { prisma } from '@/lib/prisma';
import {
  createLeagueTrade,
  executeLeagueTradeAction,
  processDueLeagueTrades,
} from '@/server/leagues/trades/tradeService';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';

const LEAGUE = 'int-locked-moves-league';
const SETTINGS = 'int-locked-moves-settings';
const SEASON = 'int-locked-moves-2026';
const FIRST_USER = 'int-locked-moves-user-first';
const SECOND_USER = 'int-locked-moves-user-second';
const FIRST = 'int-locked-moves-member-first';
const SECOND = 'int-locked-moves-member-second';
const P = {
  firstStarted: 'int-locked-moves-first-carlton',
  firstWaiting: 'int-locked-moves-first-geelong',
  firstSpare: 'int-locked-moves-first-geelong-spare',
  secondWaiting: 'int-locked-moves-second-geelong',
  secondStarted: 'int-locked-moves-second-carlton',
} as const;

// Saturday of round 2: the Carlton game has started, the Geelong game has not.
const MID_ROUND = new Date('2026-07-18T06:00:00.000Z');
const BEFORE_ROUND = new Date('2026-07-15T00:00:00.000Z');

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: Object.values(P),
    settingsIds: [SETTINGS],
    userIds: [FIRST_USER, SECOND_USER],
  });

async function seed() {
  await removeFixture();
  await prisma.user.createMany({
    data: [FIRST_USER, SECOND_USER].map((id) => ({
      id,
      email: `${id}@statly.local`,
      passwordHash: 'x',
      displayName: id,
    })),
  });
  await prisma.leagueSettings.create({
    data: {
      id: SETTINGS,
      rosterSize: 4,
      benchSize: 2,
      maxTeams: 4,
      pickSeconds: 60,
      draftType: 'SNAKE',
      tradeLimit: 10,
      tradeReviewMode: 'NONE',
      tradeOfferExpiryHours: 240,
      tradeReviewHours: 24,
      tradeVetoThreshold: 3,
      competitionRulesVersion: 1,
      competitionStatus: 'ACTIVE',
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Locked moves',
      inviteCode: 'INTLOCKMV',
      ownerId: FIRST_USER,
      settingsId: SETTINGS,
    },
  });
  await prisma.leagueSeason.create({
    data: { id: SEASON, leagueId: LEAGUE, label: '2026 season', year: 2026 },
  });
  await prisma.league.update({ where: { id: LEAGUE }, data: { activeSeasonId: SEASON } });
  await prisma.draft.create({ data: { leagueId: LEAGUE, status: 'COMPLETED', totalPicks: 10 } });
  await prisma.leagueMember.createMany({
    data: [
      { id: FIRST, leagueId: LEAGUE, userId: FIRST_USER, role: 'OWNER', teamName: 'First' },
      { id: SECOND, leagueId: LEAGUE, userId: SECOND_USER, role: 'MANAGER', teamName: 'Second' },
    ],
  });
  await prisma.player.createMany({
    data: [
      { id: P.firstStarted, name: 'First Started', club: 'Carlton', position: 'MID' },
      { id: P.firstWaiting, name: 'First Waiting', club: 'Geelong', position: 'MID' },
      { id: P.firstSpare, name: 'First Spare', club: 'Geelong', position: 'FWD' },
      { id: P.secondWaiting, name: 'Second Waiting', club: 'Geelong', position: 'DEF' },
      { id: P.secondStarted, name: 'Second Started', club: 'Carlton', position: 'RUC' },
    ],
  });
  await prisma.leagueRosterPlayer.createMany({
    data: [
      { leagueId: LEAGUE, memberId: FIRST, playerId: P.firstStarted },
      { leagueId: LEAGUE, memberId: FIRST, playerId: P.firstWaiting },
      { leagueId: LEAGUE, memberId: FIRST, playerId: P.firstSpare },
      { leagueId: LEAGUE, memberId: SECOND, playerId: P.secondWaiting },
      { leagueId: LEAGUE, memberId: SECOND, playerId: P.secondStarted },
    ],
  });
  const rounds = [
    {
      round: 1,
      status: 'FINAL',
      startsAt: '2026-07-09T09:00:00.000Z',
      endsAt: '2026-07-12T09:00:00.000Z',
    },
    {
      round: 2,
      status: 'PENDING',
      startsAt: '2026-07-16T09:00:00.000Z',
      endsAt: '2026-07-19T09:00:00.000Z',
    },
    {
      round: 3,
      status: 'SCHEDULED',
      startsAt: '2026-07-23T09:00:00.000Z',
      endsAt: '2026-07-26T09:00:00.000Z',
    },
  ] as const;
  for (const round of rounds) {
    await prisma.leagueCompetitionRound.create({
      data: {
        leagueId: LEAGUE,
        seasonId: SEASON,
        fixtureVersion: 1,
        round: round.round,
        aflRound: round.round,
        status: round.status,
        startsAt: new Date(round.startsAt),
        endsAt: new Date(round.endsAt),
      },
    });
  }
  // Every member names every player of his in every round; no row carries a stamped lock.
  for (const [memberId, playerIds] of [
    [FIRST, [P.firstStarted, P.firstWaiting, P.firstSpare]],
    [SECOND, [P.secondWaiting, P.secondStarted]],
  ] as const) {
    for (const round of [1, 2, 3]) {
      await prisma.leagueLineup.create({
        data: {
          leagueId: LEAGUE,
          seasonId: SEASON,
          memberId,
          round,
          players: {
            create: playerIds.map((playerId, slotIndex) => ({
              playerId,
              slot: 'INTERCHANGE' as const,
              slotIndex,
            })),
          },
        },
      });
    }
  }
}

async function lineupRounds(memberId: string, playerId: string): Promise<number[]> {
  const rows = await prisma.leagueLineupPlayer.findMany({
    where: { playerId, lineup: { leagueId: LEAGUE, memberId } },
    select: { lineup: { select: { round: true } } },
  });
  return rows.map((row) => row.lineup.round).sort();
}

async function ownerOf(playerId: string): Promise<string | undefined> {
  const row = await prisma.leagueRosterPlayer.findUnique({
    where: { leagueId_playerId: { leagueId: LEAGUE, playerId } },
    select: { memberId: true },
  });
  return row?.memberId;
}

async function drop(playerId: string): Promise<Response> {
  auth.userId = FIRST_USER;
  const response = await POST(
    new Request(`https://statly.test/api/leagues/${LEAGUE}/actions/${FIRST_USER}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actionType: 'DROP_PLAYER', details: { playerId } }),
    }) as NextRequest,
    { params: Promise.resolve({ id: LEAGUE, userId: FIRST_USER }) }
  );
  if (!response) throw new Error('POST returned no response');
  return response;
}

function propose(sending: string, receiving: string, now: Date, key: string) {
  return createLeagueTrade(
    LEAGUE,
    FIRST_USER,
    {
      recipientMemberId: SECOND,
      sendingPlayerIds: [sending],
      receivingPlayerIds: [receiving],
      idempotencyKey: key,
    },
    now
  );
}

describe('players whose game has started this round', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ now: MID_ROUND, toFake: ['Date'] });
    await seed();
  });

  afterAll(async () => {
    vi.useRealTimers();
    await removeFixture();
  });

  it('refuses to drop a started player and leaves his roster and lineups alone', async () => {
    const response = await drop(P.firstStarted);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(JSON.stringify(body)).toContain(
      "First Started's game has started; he can be moved after the round ends."
    );
    await expect(ownerOf(P.firstStarted)).resolves.toBe(FIRST);
    await expect(lineupRounds(FIRST, P.firstStarted)).resolves.toEqual([1, 2, 3]);
  });

  it('drops a player whose game has not started and removes him from the open lineups only', async () => {
    const response = await drop(P.firstSpare);

    expect(response.status).toBe(200);
    await expect(ownerOf(P.firstSpare)).resolves.toBeUndefined();
    // Round 1 is scored history; rounds 2 (in progress, his game not started) and 3 are open.
    await expect(lineupRounds(FIRST, P.firstSpare)).resolves.toEqual([1]);
  });

  it('refuses a trade proposal that includes a started player', async () => {
    await expect(
      propose(P.firstWaiting, P.secondStarted, MID_ROUND, 'locked-propose-0001')
    ).rejects.toMatchObject({
      code: 'PLAYER_LOCKED',
      status: 409,
      message: "Second Started's game has started; he can be moved after the round ends.",
    });
    await expect(prisma.leagueTradeThread.count({ where: { leagueId: LEAGUE } })).resolves.toBe(0);
  });

  it('refuses to accept, mid-round, a trade proposed before a traded player started', async () => {
    const created = await propose(
      P.firstStarted,
      P.secondWaiting,
      BEFORE_ROUND,
      'locked-accept-0001'
    );

    auth.userId = SECOND_USER;
    await expect(
      executeLeagueTradeAction(
        LEAGUE,
        SECOND_USER,
        created.threadId,
        {
          action: 'accept',
          expectedVersion: created.version,
          idempotencyKey: 'locked-accept-0002',
        },
        MID_ROUND
      )
    ).rejects.toMatchObject({ code: 'PLAYER_LOCKED', status: 409 });
    await expect(ownerOf(P.firstStarted)).resolves.toBe(FIRST);
    await expect(ownerOf(P.secondWaiting)).resolves.toBe(SECOND);
  });

  it('completes a trade of players yet to play and moves them out of the old open lineups', async () => {
    const created = await propose(P.firstWaiting, P.secondWaiting, MID_ROUND, 'open-trade-0001');
    await expect(
      executeLeagueTradeAction(
        LEAGUE,
        SECOND_USER,
        created.threadId,
        { action: 'accept', expectedVersion: created.version, idempotencyKey: 'open-trade-0002' },
        MID_ROUND
      )
    ).resolves.toMatchObject({ status: 'COMPLETED' });

    await expect(ownerOf(P.firstWaiting)).resolves.toBe(SECOND);
    await expect(lineupRounds(FIRST, P.firstWaiting)).resolves.toEqual([1]);
    await expect(lineupRounds(SECOND, P.secondWaiting)).resolves.toEqual([1]);
  });

  it('holds a vetoable trade whose review ends mid-round until the round ends', async () => {
    await prisma.leagueSettings.update({
      where: { id: SETTINGS },
      data: { tradeReviewMode: 'VETO' },
    });
    const created = await propose(P.firstStarted, P.secondWaiting, BEFORE_ROUND, 'veto-trade-0001');
    await executeLeagueTradeAction(
      LEAGUE,
      SECOND_USER,
      created.threadId,
      { action: 'accept', expectedVersion: created.version, idempotencyKey: 'veto-trade-0002' },
      BEFORE_ROUND
    );

    await expect(processDueLeagueTrades(MID_ROUND)).resolves.toBe(0);
    await expect(
      prisma.leagueTradeThread.findUniqueOrThrow({ where: { id: created.threadId } })
    ).resolves.toMatchObject({ status: 'PENDING_VETO_REVIEW' });
    await expect(ownerOf(P.firstStarted)).resolves.toBe(FIRST);

    const afterRound = new Date('2026-07-20T00:00:00.000Z');
    vi.setSystemTime(afterRound);
    await expect(processDueLeagueTrades(afterRound)).resolves.toBe(1);
    await expect(ownerOf(P.firstStarted)).resolves.toBe(SECOND);
  });
});
