/**
 * The daily 6 am Melbourne waiver run against PostgreSQL: due claims are processed in that hour only,
 * and claims whose waiver period has not ended are left pending.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: {} }));

import { prisma } from '@/lib/prisma';
import {
  PrismaWaiverClaimStore,
  WaiverProcessingService,
} from '@/server/waivers/WaiverProcessingService';
import { processDueLeagueWaivers } from '@/server/waivers/waiverSchedule';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';

const LEAGUE = 'int-waiver-schedule-league';
const SETTINGS = 'int-waiver-schedule-settings';
const USER = 'int-waiver-schedule-user';
const MEMBER = `${USER}-member`;
const PLAYERS = ['int-waiver-schedule-due', 'int-waiver-schedule-later'];
// 6:30 am and 7:30 am in Melbourne on 15 January (daylight saving, UTC+11).
const SIX_AM = new Date('2026-01-14T19:30:00Z');
const SEVEN_AM = new Date('2026-01-14T20:30:00Z');

// Firestore is a write-only compatibility projection here; nothing under test reads it back.
const firestoreDoc = {
  get: async () => ({ exists: false, data: () => undefined }),
  set: async () => undefined,
  update: async () => undefined,
};
const firestore = { doc: () => firestoreDoc, collection: () => ({ doc: () => firestoreDoc }) };
const store = new PrismaWaiverClaimStore(prisma, firestore as never);
const service = new WaiverProcessingService(prisma, store, { projectLeague: vi.fn() } as never);

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: PLAYERS,
    settingsIds: [SETTINGS],
    userIds: [USER],
  });

beforeEach(async () => {
  await removeFixture();
  await prisma.user.create({
    data: { id: USER, email: `${USER}@statly.local`, passwordHash: 'x', displayName: USER },
  });
  await prisma.player.createMany({
    data: PLAYERS.map((id) => ({ id, name: id, club: 'Test', position: 'MID' })),
  });
  await prisma.leagueSettings.create({
    data: {
      id: SETTINGS,
      rosterSize: 4,
      benchSize: 0,
      maxTeams: 2,
      pickSeconds: 60,
      draftType: 'SNAKE',
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Schedule',
      inviteCode: 'INTWSCHD',
      ownerId: USER,
      settingsId: SETTINGS,
    },
  });
  await prisma.leagueMember.create({
    data: { id: MEMBER, leagueId: LEAGUE, userId: USER, role: 'OWNER', teamName: 'Early Risers' },
  });
  for (const playerId of PLAYERS) {
    await store.submitClaim({
      leagueId: LEAGUE,
      userId: USER,
      teamId: MEMBER,
      playerId,
      priority: 1,
      waiverSettings: { system: 'PRIORITY' },
    });
  }
  // One claim's waiver period has ended by 6 am; the other's has not ended at all yet.
  await prisma.teamAction.updateMany({
    where: { leagueId: LEAGUE, details: { contains: PLAYERS[0] } },
    data: { processingAt: new Date(SIX_AM.getTime() - 60_000) },
  });
  await prisma.teamAction.updateMany({
    where: { leagueId: LEAGUE, details: { contains: PLAYERS[1] } },
    // Processing itself judges due-ness by the real clock, so "not yet" must be in the real future.
    data: { processingAt: new Date(Date.now() + 24 * 60 * 60_000) },
  });
});

afterAll(removeFixture);

const statusOf = async (playerId: string) =>
  (
    await prisma.teamAction.findFirstOrThrow({
      where: { leagueId: LEAGUE, details: { contains: playerId } },
      select: { status: true },
    })
  ).status;

describe('daily waiver run', () => {
  it('does nothing outside the 6 am Melbourne hour', async () => {
    await expect(processDueLeagueWaivers(SEVEN_AM, service)).resolves.toEqual({
      ran: false,
      leagues: [],
    });
    expect(await statusOf(PLAYERS[0])).toBe('PENDING');
  });

  it('processes due claims at 6 am and leaves claims that are not yet due', async () => {
    const run = await processDueLeagueWaivers(SIX_AM, service);

    expect(run.ran).toBe(true);
    expect(run.leagues.find((league) => league.leagueId === LEAGUE)).toMatchObject({
      processed: 1,
    });
    expect(await statusOf(PLAYERS[0])).toBe('PROCESSED');
    expect(await statusOf(PLAYERS[1])).toBe('PENDING');
    expect(
      await prisma.leagueRosterPlayer.count({ where: { leagueId: LEAGUE, playerId: PLAYERS[0] } })
    ).toBe(1);
  });
});
