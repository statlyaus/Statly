/**
 * A settings save racing a draft start (#1298). The route reads the locks before its write
 * transaction; a draft start that commits in between must still lock the draft structure. Both take
 * the League row lock, so the save re-reads the draft after the start commits and refuses.
 */
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: {} }));
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId: vi.fn(async () => 'int-race-user') }));
vi.mock('@/server/leagues/membership', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/leagues/membership')>()),
  getLeagueMembershipAccess: vi.fn(async () => ({
    isMember: true,
    canManage: true,
    memberId: 'int-race-user-member',
  })),
}));
vi.mock('@/server/draft/services/DraftSetupConvergenceService', () => ({
  ensureLeagueDraftSetupConverged: vi.fn(),
}));

import { PUT } from '@/app/api/leagues/[id]/settings/route';
import { prisma } from '@/lib/prisma';
import { lockLeagueRow } from '@/server/leagues/leagueRowLock';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';
import { activateLeagueSeason } from './helpers/leagueSeason';

const LEAGUE = 'int-race-league';
const SETTINGS = 'int-race-settings';
const DRAFT = 'int-race-draft';
const USER = 'int-race-user';

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: ['int-race-player'],
    settingsIds: [SETTINGS],
    userIds: [USER],
  });

async function seedFixture() {
  await prisma.user.create({
    data: { id: USER, email: `${USER}@statly.local`, passwordHash: 'x', displayName: USER },
  });
  await prisma.leagueSettings.create({
    data: {
      id: SETTINGS,
      rosterSize: 18,
      benchSize: 4,
      maxTeams: 8,
      pickSeconds: 120,
      allowAutoPick: true,
      draftType: 'SNAKE',
      pickOrder: 'RANDOM',
      waiverRule: 'ROLLING',
      startAt: new Date(Date.now() + 86_400_000),
      timeZone: 'Australia/Melbourne',
      locked: false,
    },
  });
  await prisma.league.create({
    data: { id: LEAGUE, name: 'Race', inviteCode: 'INTRACE', ownerId: USER, settingsId: SETTINGS },
  });
  await activateLeagueSeason(prisma, LEAGUE);
  await prisma.leagueMember.create({
    data: {
      id: `${USER}-member`,
      leagueId: LEAGUE,
      userId: USER,
      role: 'OWNER',
      teamName: 'Team 1',
      draftSlot: 1,
    },
  });
  await prisma.draft.create({
    data: {
      id: DRAFT,
      leagueId: LEAGUE,
      status: 'SCHEDULED',
      currentPick: 1,
      totalPicks: 18,
      round: 1,
      direction: 'FORWARD',
      lobbyStatus: 'COUNTDOWN',
    },
  });
}

function saveDraftType(draftType: string) {
  return PUT(
    new NextRequest(`http://localhost/api/leagues/${LEAGUE}/settings`, {
      method: 'PUT',
      body: JSON.stringify({ draft: { draftType } }),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id: LEAGUE }) }
  );
}

/** Waits until some other session is blocked on a row lock, i.e. the save reached its transaction. */
async function waitForLockWaiter() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await prisma.$queryRaw<{ waiting: bigint }[]>`
      SELECT count(*) AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (Number(row.waiting) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('the settings save never waited on the League row lock');
}

beforeEach(async () => {
  await removeFixture();
  await seedFixture();
});

afterAll(removeFixture);

describe('a settings save racing a draft start', () => {
  it('refuses a draft-structure change when the draft starts while the save is in flight', async () => {
    let releaseStart!: () => void;
    const startMayCommit = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    let startHoldsLock!: () => void;
    const lockHeld = new Promise<void>((resolve) => {
      startHoldsLock = resolve;
    });

    // The draft start: takes the League row lock (as DraftApplicationService.startDraft does), goes
    // LIVE, and holds its transaction open until the save is queued behind it.
    const start = prisma.$transaction(
      async (tx) => {
        await lockLeagueRow(tx, LEAGUE);
        await tx.draft.update({
          where: { id: DRAFT },
          data: { status: 'LIVE', lobbyStatus: 'LIVE', startedAt: new Date() },
        });
        startHoldsLock();
        await startMayCommit;
      },
      { timeout: 20_000 }
    );
    await lockHeld;

    // The save reads the locks outside the transaction (draft still SCHEDULED: the start has not
    // committed), then blocks on the League row lock.
    const save = saveDraftType('linear');
    await waitForLockWaiter();
    releaseStart();
    await start;

    const response = await save;
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'DRAFT_STRUCTURE_LOCKED' });
    const settings = await prisma.leagueSettings.findUniqueOrThrow({ where: { id: SETTINGS } });
    expect(settings.draftType).toBe('SNAKE');
  });

  it('keeps the draft structure locked after a LIVE draft is rescheduled with its picks', async () => {
    await prisma.player.create({
      data: { id: 'int-race-player', name: 'Picked', club: 'Test', position: 'MID' },
    });
    await prisma.pick.create({
      data: {
        draftId: DRAFT,
        memberId: `${USER}-member`,
        playerId: 'int-race-player',
        overall: 1,
        round: 1,
        slot: 1,
      },
    });

    try {
      const response = await saveDraftType('linear');
      expect(response.status).toBe(409);
    } finally {
      await prisma.pick.deleteMany({ where: { draftId: DRAFT } });
      await prisma.player.deleteMany({ where: { id: 'int-race-player' } });
    }
  });

  it('saves a draft-structure change while the draft is still scheduled', async () => {
    const response = await saveDraftType('linear');

    expect(response.status).toBe(200);
    const settings = await prisma.leagueSettings.findUniqueOrThrow({ where: { id: SETTINGS } });
    expect(settings.draftType).toBe('LINEAR');
  });
});
