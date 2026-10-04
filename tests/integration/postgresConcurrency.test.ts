/**
 * Two writers at once against PostgreSQL. SQLite's single writer lock serialized these paths, so the
 * read-check-write races below could not happen there; PostgreSQL runs them concurrently (#750).
 * Each race repeats for several rounds because a single interleaving can pass by luck.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: {} }));
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/server/rosters/RosterProjectionService', () => ({
  RosterProjectionService: class {
    async projectDraft(): Promise<void> {}
  },
}));
vi.mock('@/server/leagues/membership', () => ({
  getDraftMembershipAccess: vi.fn(),
  isActivePrismaMembership: (member: { isActive: boolean; status: string }) =>
    member.isActive &&
    !['declined', 'inactive', 'removed'].includes(member.status.trim().toLowerCase()),
}));

import { prisma } from '@/lib/prisma';
import { DraftApplicationService } from '@/server/draft/services/DraftApplicationService';
import { PrismaWaiverClaimStore, type WaiverClaim } from '@/server/waivers/WaiverProcessingService';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';

const ROUNDS = 8;
const LEAGUE = 'int-concurrency-league';
const SETTINGS = 'int-concurrency-settings';
const DRAFT = 'int-concurrency-draft';
const users = ['a', 'b'].map((name) => `int-concurrency-user-${name}`);
const members = users.map((id) => `${id}-member`);
const players = ['p1', 'p2', 'p3'].map((name) => `int-concurrency-${name}`);
const FAAB = { system: 'FAAB', faabBudget: 100 } as const;

// Firestore is a write-only compatibility projection here; nothing under test reads it back.
const firestoreDoc = {
  get: async () => ({ exists: false, data: () => undefined }),
  set: async () => undefined,
  update: async () => undefined,
};
const firestore = { doc: () => firestoreDoc, collection: () => ({ doc: () => firestoreDoc }) };
const store = () => new PrismaWaiverClaimStore(prisma, firestore as never);

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: players,
    settingsIds: [SETTINGS],
    userIds: users,
  });

async function seedFixture() {
  const startedAt = new Date();
  await prisma.user.createMany({
    data: users.map((id) => ({
      id,
      email: `${id}@statly.local`,
      passwordHash: 'x',
      displayName: id,
    })),
  });
  await prisma.player.createMany({
    data: players.map((id) => ({ id, name: id, club: 'Test', position: 'MID' })),
  });
  await prisma.leagueSettings.create({
    data: {
      id: SETTINGS,
      rosterSize: 1,
      benchSize: 0,
      maxTeams: 2,
      pickSeconds: 120,
      allowAutoPick: true,
      draftType: 'SNAKE',
      pickOrder: 'MANUAL',
      waiverRule: 'WEEKLY',
      startAt: startedAt,
      timeZone: 'Australia/Melbourne',
      locked: true,
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Concurrency',
      inviteCode: 'INTCONC',
      ownerId: users[0],
      settingsId: SETTINGS,
    },
  });
  await prisma.leagueMember.createMany({
    data: members.map((id, index) => ({
      id,
      leagueId: LEAGUE,
      userId: users[index],
      role: index === 0 ? 'OWNER' : 'MANAGER',
      teamName: `Team ${index + 1}`,
      draftSlot: index + 1,
    })),
  });
  await prisma.draft.create({
    data: {
      id: DRAFT,
      leagueId: LEAGUE,
      status: 'LIVE',
      currentPick: 1,
      totalPicks: 2,
      round: 1,
      direction: 'FORWARD',
      lobbyStatus: 'LIVE',
      startedAt,
      pickStartedAt: startedAt,
      pickDeadlineAt: new Date(startedAt.getTime() + 120_000),
      clockDurationSeconds: 120,
    },
  });
  await prisma.draftOrder.createMany({
    data: members.map((memberId, index) => ({ draftId: DRAFT, memberId, slot: index + 1 })),
  });
}

const claim = (overrides: Partial<WaiverClaim>): WaiverClaim => ({
  id: 'claim',
  leagueId: LEAGUE,
  userId: users[0],
  teamId: members[0],
  playerId: players[0],
  priority: 1,
  status: 'PENDING',
  createdAt: new Date(),
  ...overrides,
});

const priorityRow = () =>
  prisma.waiverPriority.findUniqueOrThrow({
    where: { leagueId_memberId: { leagueId: LEAGUE, memberId: members[0] } },
  });

beforeEach(async () => {
  await removeFixture();
  await seedFixture();
});

afterAll(removeFixture);

describe('waiver FAAB under two writers', () => {
  it('reserves at most the budget when two claims race past it', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await prisma.teamAction.deleteMany({ where: { leagueId: LEAGUE } });
      await prisma.waiverPriority.deleteMany({ where: { leagueId: LEAGUE } });
      // The rows exist up front, so the race is on the reservation, not on creating the rows.
      await prisma.waiverPriority.createMany({
        data: members.map((memberId, index) => ({
          leagueId: LEAGUE,
          memberId,
          priority: index + 1,
          remainingFAAB: 100,
        })),
      });

      const results = await Promise.allSettled(
        [players[0], players[1]].map((playerId) =>
          store().submitClaim({
            leagueId: LEAGUE,
            userId: users[0],
            teamId: members[0],
            playerId,
            priority: 1,
            bidAmount: 60,
            waiverSettings: FAAB,
          })
        )
      );

      expect(
        results.filter((result) => result.status === 'fulfilled'),
        `round ${round}`
      ).toHaveLength(1);
      expect((await priorityRow()).pendingBidTotal, `round ${round}`).toBe(60);
      expect(
        await prisma.teamAction.count({ where: { leagueId: LEAGUE, status: 'PENDING' } }),
        `round ${round}`
      ).toBe(1);
    }
  });

  it('keeps both first claims when they race to create the priority rows', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await prisma.teamAction.deleteMany({ where: { leagueId: LEAGUE } });
      await prisma.waiverPriority.deleteMany({ where: { leagueId: LEAGUE } });

      const results = await Promise.allSettled(
        [0, 1].map((index) =>
          store().submitClaim({
            leagueId: LEAGUE,
            userId: users[index],
            teamId: members[index],
            playerId: players[index],
            priority: 1,
            waiverSettings: { system: 'PRIORITY' },
          })
        )
      );

      expect(
        results.map((result) => result.status),
        `round ${round}`
      ).toEqual(['fulfilled', 'fulfilled']);
      const rows = await prisma.waiverPriority.findMany({
        where: { leagueId: LEAGUE },
        select: { memberId: true },
      });
      expect(rows.map((row) => row.memberId).sort(), `round ${round}`).toEqual([...members].sort());
    }
  });

  it('applies both debits when two debits race', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await prisma.waiverPriority.deleteMany({ where: { leagueId: LEAGUE } });
      await prisma.waiverPriority.create({
        data: { leagueId: LEAGUE, memberId: members[0], priority: 1, remainingFAAB: 100 },
      });

      const results = await Promise.all([
        store().debitFaab(claim({ id: 'debit-30', bidAmount: 30 }), FAAB),
        store().debitFaab(claim({ id: 'debit-40', bidAmount: 40 }), FAAB),
      ]);

      expect(results, `round ${round}`).toEqual([{ ok: true }, { ok: true }]);
      expect((await priorityRow()).remainingFAAB, `round ${round}`).toBe(30);
    }
  });
});

describe('draft pick under two writers', () => {
  it('refuses a player drafted at another slot instead of failing the aborted transaction', async () => {
    const service = new DraftApplicationService({ projectDraft: vi.fn() } as never);
    // A stale client submits a player who already holds a later slot: the insert violates
    // (draftId, playerId), which PostgreSQL answers by aborting the whole transaction.
    await prisma.pick.create({
      data: {
        draftId: DRAFT,
        overall: 2,
        round: 1,
        slot: 2,
        memberId: members[1],
        playerId: players[0],
      },
    });

    await expect(
      service.makePick({ draftId: DRAFT, actorUserId: users[0], playerId: players[0] })
    ).rejects.toThrow('bad_request:Player already picked');
    expect(
      await prisma.draft.findUniqueOrThrow({ where: { id: DRAFT }, select: { currentPick: true } })
    ).toEqual({ currentPick: 1 });
  });

  it('persists exactly one pick when the member on the clock submits twice at once', async () => {
    const service = new DraftApplicationService({ projectDraft: vi.fn() } as never);

    for (let round = 0; round < ROUNDS; round += 1) {
      // Events are keyed by clock revision, which follows schedulingVersion, so the previous round's
      // events must go when the version is reset.
      await prisma.draftEvent.deleteMany({ where: { draftId: DRAFT } });
      await prisma.pick.deleteMany({ where: { draftId: DRAFT } });
      await prisma.draft.update({
        where: { id: DRAFT },
        data: { status: 'LIVE', currentPick: 1, schedulingVersion: 0 },
      });

      const sent = [players[0], players[1]];
      const results = await Promise.allSettled(
        sent.map((playerId) =>
          service.makePick({ draftId: DRAFT, actorUserId: users[0], playerId })
        )
      );

      const persisted = await prisma.pick.findMany({
        where: { draftId: DRAFT },
        select: { playerId: true },
      });
      expect(persisted, `round ${round}`).toHaveLength(1);
      for (const [index, result] of results.entries()) {
        if (result.status === 'fulfilled') {
          // Success, first-hand or replayed, only ever reports the player this call sent, and that
          // player is the one that persisted.
          expect(result.value.data.pick.player.id, `round ${round}`).toBe(sent[index]);
          expect(persisted[0].playerId, `round ${round}`).toBe(sent[index]);
        } else {
          // The loser gets a domain refusal, not a raw database error surfacing as a 500.
          expect(String(result.reason?.message), `round ${round}`).toMatch(
            /^(bad_request|conflict|forbidden):/
          );
        }
      }
      expect(
        await prisma.draft.findUniqueOrThrow({
          where: { id: DRAFT },
          select: { currentPick: true, schedulingVersion: true },
        }),
        `round ${round}`
      ).toEqual({ currentPick: 2, schedulingVersion: 1 });
    }
  });
});
