/**
 * A missed 6 am Melbourne waiver run is caught up by a later hourly call the same day, against the
 * real claim queries: only claims due by that day's 6 am run settle, and a day whose run completed
 * is left alone.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: {} }));

import { prisma } from '@/lib/prisma';
import { PrismaWaiverClaimStore } from '@/server/waivers/WaiverProcessingService';
import { processDueLeagueWaivers } from '@/server/waivers/waiverSchedule';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';
import { activateLeagueSeason } from './helpers/leagueSeason';

const LEAGUE = 'int-waiver-catchup-league';
const SETTINGS = 'int-waiver-catchup-settings';
const USER = 'int-waiver-catchup-user';
const MEMBER = `${USER}-member`;
let seasonId = '';

// Melbourne standard time (UTC+10) on 15 July 2026.
const FIVE_AM = new Date('2026-07-14T19:00:00Z');
const SIX_AM = new Date('2026-07-14T20:00:00Z');
const SEVEN_AM = new Date('2026-07-14T21:00:00Z');
const NINE_AM = new Date('2026-07-14T23:00:00Z');

const store = () => new PrismaWaiverClaimStore(prisma, {} as never);

// Stands in for the processing service: records which claims a run would settle, via the real store.
function recordingService() {
  const settled: string[] = [];
  return {
    settled,
    async processLeague({ leagueId, dueBy }: { leagueId: string; dueBy?: Date }) {
      const claims = await store().loadPendingClaims(leagueId, dueBy);
      settled.push(...claims.map((claim) => claim.id));
      return { processed: claims.length, results: [] };
    },
  };
}

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: [],
    settingsIds: [SETTINGS],
    userIds: [USER],
  });

const claim = (id: string, processingAt: Date, status: 'PENDING' | 'PROCESSED' = 'PENDING') => ({
  id,
  leagueId: LEAGUE,
  seasonId,
  memberId: MEMBER,
  actionType: 'WAIVER_CLAIM' as const,
  status,
  details: { playerId: `${id}-player`, priority: 1 },
  processingAt,
  createdAt: new Date(processingAt.getTime() - 24 * 60 * 60 * 1000),
  ...(status === 'PROCESSED' ? { processedAt: SIX_AM } : {}),
});

beforeEach(async () => {
  await removeFixture();
  await prisma.user.create({
    data: { id: USER, email: `${USER}@statly.local`, passwordHash: 'x', displayName: USER },
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
      name: 'Catch-up',
      inviteCode: 'INTWCTCH',
      ownerId: USER,
      settingsId: SETTINGS,
    },
  });
  seasonId = await activateLeagueSeason(prisma, LEAGUE);
  await prisma.leagueMember.create({
    data: { id: MEMBER, leagueId: LEAGUE, userId: USER, role: 'OWNER', teamName: 'A' },
  });
});

afterAll(removeFixture);

describe('catching up a missed daily waiver run', () => {
  it('settles at 9 am the claim due at the missed 6 am run, not the one due at 7 am', async () => {
    await prisma.teamAction.createMany({
      data: [claim('catchup-due', FIVE_AM), claim('catchup-later', SEVEN_AM)],
    });
    const service = recordingService();

    const run = await processDueLeagueWaivers(NINE_AM, service);

    expect(run.ran).toBe(true);
    expect(service.settled).toEqual(['catchup-due']);
  });

  it('leaves the day alone at 9 am when the 6 am run completed', async () => {
    await prisma.teamAction.createMany({
      data: [claim('catchup-done', FIVE_AM, 'PROCESSED'), claim('catchup-later', SEVEN_AM)],
    });
    const service = recordingService();

    const run = await processDueLeagueWaivers(NINE_AM, service);

    expect(run).toEqual({ ran: false, leagues: [], failedLeagueIds: [] });
    expect(service.settled).toEqual([]);
  });

  it('settles the 7 am claim at the next 6 am run as before', async () => {
    await prisma.teamAction.createMany({ data: [claim('catchup-later', SEVEN_AM)] });
    const service = recordingService();

    const run = await processDueLeagueWaivers(new Date('2026-07-15T20:00:00Z'), service);

    expect(run.ran).toBe(true);
    expect(service.settled).toEqual(['catchup-later']);
  });
});
