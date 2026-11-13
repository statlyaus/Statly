/**
 * Bloodsucker 4/9 (#1281, BR-15, BR-16): the Bloodsucker is pinned at waiver priority 1. Run against
 * PostgreSQL because the order is seeded inside the draft's final transaction, re-seeded on the first
 * claim, and rewritten inside each claim's settling transaction.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: {} }));
vi.mock('@/server/waivers/waiverActivity', () => ({ publishWaiverOutcome: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { RosterProjectionService } from '@/server/rosters/RosterProjectionService';
import {
  PrismaWaiverClaimStore,
  WaiverProcessingService,
} from '@/server/waivers/WaiverProcessingService';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';
import { activateLeagueSeason } from './helpers/leagueSeason';

const PREFIX = 'int-bs-priority';
const LEAGUE = `${PREFIX}-league`;
const SETTINGS = `${PREFIX}-settings`;
const DRAFT = `${PREFIX}-draft`;
const USERS = ['sucker', 'early', 'late'].map((key) => `${PREFIX}-${key}`);
const [SUCKER_USER, EARLY_USER, LATE_USER] = USERS as [string, string, string];
const member = (userId: string) => `${userId}-member`;
const [SUCKER, EARLY, LATE] = USERS.map(member) as [string, string, string];
const DRAFTED = ['d1', 'd2', 'd3', 'd4'].map((key) => `${PREFIX}-${key}`);
const FREE = ['f1', 'f2', 'f3'].map((key) => `${PREFIX}-${key}`);
const [FREE_1, FREE_2, FREE_3] = FREE as [string, string, string];

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
    playerIds: [...DRAFTED, ...FREE],
    settingsIds: [SETTINGS],
    userIds: USERS,
  });

async function createLeague(leagueFormat: 'BLOODSUCKER' | 'STANDARD') {
  await removeFixture();
  await prisma.user.createMany({
    data: USERS.map((id) => ({
      id,
      email: `${id}@statly.local`,
      passwordHash: 'x',
      displayName: id,
    })),
  });
  await prisma.player.createMany({
    data: [...DRAFTED, ...FREE].map((id) => ({ id, name: id, club: 'Test', position: 'MID' })),
  });
  await prisma.leagueSettings.create({
    data: {
      id: SETTINGS,
      rosterSize: 6,
      benchSize: 0,
      maxTeams: 3,
      pickSeconds: 60,
      draftType: 'SNAKE',
      waiverRule: 'ROLLING',
      leagueFormat,
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Bloodsucker priority',
      inviteCode: 'BSPRIOR',
      ownerId: EARLY_USER,
      settingsId: SETTINGS,
    },
  });
  await activateLeagueSeason(prisma, LEAGUE);
  await prisma.leagueMember.createMany({
    data: USERS.map((userId) => ({
      id: member(userId),
      leagueId: LEAGUE,
      userId,
      teamName: userId,
      role: userId === EARLY_USER ? 'OWNER' : 'MANAGER',
    })),
  });
  if (leagueFormat === 'BLOODSUCKER') {
    await prisma.leagueSettings.update({
      where: { id: SETTINGS },
      data: { bloodsuckerMemberId: SUCKER },
    });
  }
}

/** A finished snake draft between the two drafters: EARLY makes the last pick, so it seeds first. */
async function completeDraft() {
  await prisma.draft.create({
    data: { id: DRAFT, leagueId: LEAGUE, status: 'COMPLETED', totalPicks: 4 },
  });
  const order = [EARLY, LATE, LATE, EARLY];
  await prisma.pick.createMany({
    data: DRAFTED.map((playerId, index) => ({
      draftId: DRAFT,
      overall: index + 1,
      round: index < 2 ? 1 : 2,
      slot: (index % 2) + 1,
      memberId: order[index]!,
      playerId,
    })),
  });
  await prisma.$transaction((tx) =>
    new RosterProjectionService().projectDraftInTx(tx, { leagueId: LEAGUE, draftId: DRAFT })
  );
}

const priorities = async () =>
  (
    await prisma.waiverPriority.findMany({
      where: { leagueId: LEAGUE },
      orderBy: { priority: 'asc' },
      select: { memberId: true, priority: true },
    })
  ).map((row) => `${row.priority}:${row.memberId}`);

async function claim(userId: string, playerId: string, priority = 1) {
  await store.submitClaim({
    leagueId: LEAGUE,
    userId,
    teamId: member(userId),
    playerId,
    priority,
    waiverSettings: { system: 'PRIORITY' },
  });
}

async function runWaivers() {
  await prisma.teamAction.updateMany({
    where: { leagueId: LEAGUE, status: 'PENDING' },
    data: { processingAt: new Date(Date.now() - 60_000) },
  });
  return service.processLeague({ leagueId: LEAGUE });
}

const ownerOf = async (playerId: string) =>
  (
    await prisma.leagueRosterPlayer.findFirst({
      where: { leagueId: LEAGUE, playerId },
      select: { memberId: true },
    })
  )?.memberId ?? null;

afterAll(removeFixture);

describe.sequential('Bloodsucker waiver priority', () => {
  describe('in a Bloodsucker league', () => {
    beforeEach(async () => {
      await createLeague('BLOODSUCKER');
    });

    it('seeds the Bloodsucker at 1 after the draft and the drafters from 2 by the draft', async () => {
      await completeDraft();

      expect(await priorities()).toEqual([`1:${SUCKER}`, `2:${EARLY}`, `3:${LATE}`]);
    });

    it('seeds the Bloodsucker at 1 on the first claim when the league has no order yet', async () => {
      // Joined last, so the join-order fallback alone would seed it last.
      await prisma.leagueMember.update({
        where: { id: SUCKER },
        data: { joinedAt: new Date(Date.now() + 60_000) },
      });
      await claim(LATE_USER, FREE_1);

      expect((await priorities())[0]).toBe(`1:${SUCKER}`);
      expect(await priorities()).toHaveLength(3);
    });

    it('wins a contested player, keeps 1 after winning, and wins again in the same run', async () => {
      await completeDraft();
      await claim(EARLY_USER, FREE_1);
      await claim(SUCKER_USER, FREE_1, 1);
      await claim(SUCKER_USER, FREE_2, 2);
      await claim(LATE_USER, FREE_2);

      await runWaivers();

      expect(await ownerOf(FREE_1)).toBe(SUCKER);
      expect(await ownerOf(FREE_2)).toBe(SUCKER);
      expect(await priorities()).toEqual([`1:${SUCKER}`, `2:${EARLY}`, `3:${LATE}`]);
    });

    it('sends another winner to the back of positions 2 and up', async () => {
      await completeDraft();
      await claim(EARLY_USER, FREE_3);

      await runWaivers();

      expect(await ownerOf(FREE_3)).toBe(EARLY);
      expect(await priorities()).toEqual([`1:${SUCKER}`, `2:${LATE}`, `3:${EARLY}`]);
    });
  });

  describe('in a standard league', () => {
    beforeEach(async () => {
      await createLeague('STANDARD');
    });

    it('keeps the draft-based seed and the plain rolling order', async () => {
      await completeDraft();
      // SUCKER drafted nothing and is not pinned: the first claim appends it last.
      await claim(LATE_USER, FREE_1);
      expect(await priorities()).toEqual([`1:${EARLY}`, `2:${LATE}`, `3:${SUCKER}`]);

      await runWaivers();

      expect(await priorities()).toEqual([`1:${EARLY}`, `2:${SUCKER}`, `3:${LATE}`]);
    });
  });
});
