/**
 * Pins the behaviour of every hand-written SQL path that the PostgreSQL move (#744) rewrites, against a
 * real database through public interfaces only. The same tests must pass before and after the rewrite,
 * and on SQLite and PostgreSQL alike.
 */
import {
  DraftDirection,
  DraftStatus,
  DraftType,
  LeagueRole,
  PickOrder,
  WaiverRule,
} from '@prisma/client';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: {} }));
vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/server/waivers/WaiverAvailabilityProjectionService', () => ({
  WaiverAvailabilityProjectionService: class {
    projectLeague = vi.fn().mockRejectedValue(new Error('projection unavailable'));
  },
}));

import { GET, POST } from '@/app/api/leagues/[id]/actions/[userId]/route';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { prisma } from '@/lib/prisma';
import { draftTransactionPatterns } from '@/lib/transactionManager';
import {
  PrismaWaiverClaimStore,
  WaiverClaimStoreError,
  type WaiverClaim,
} from '@/server/waivers/WaiverProcessingService';

const LEAGUE = 'int-raw-sql-league';
const SETTINGS = 'int-raw-sql-settings';
const DRAFT = 'int-raw-sql-draft';
const users = ['a', 'b', 'c'].map((name) => `int-raw-sql-user-${name}`);
const members = users.map((id) => `${id}-member`);
const players = ['p1', 'p2', 'p3', 'p4'].map((name) => `int-raw-sql-${name}`);
const FAAB = { system: 'FAAB', faabBudget: 100 } as const;

// Firestore is a write-only compatibility projection here; nothing under test reads it back.
const firestoreDoc = {
  get: async () => ({ exists: false, data: () => undefined }),
  set: async () => undefined,
  update: async () => undefined,
};
const firestore = { doc: () => firestoreDoc, collection: () => ({ doc: () => firestoreDoc }) };
const store = () => new PrismaWaiverClaimStore(prisma, firestore as never);

async function removeFixture() {
  await prisma.$transaction([
    prisma.teamAction.deleteMany({ where: { leagueId: LEAGUE } }),
    prisma.waiverPriority.deleteMany({ where: { leagueId: LEAGUE } }),
    prisma.leagueRosterPlayer.deleteMany({ where: { leagueId: LEAGUE } }),
    prisma.pick.deleteMany({ where: { draftId: DRAFT } }),
    prisma.draft.deleteMany({ where: { leagueId: LEAGUE } }),
    prisma.leagueMember.deleteMany({ where: { leagueId: LEAGUE } }),
    prisma.league.deleteMany({ where: { id: LEAGUE } }),
    prisma.leagueSettings.deleteMany({ where: { id: SETTINGS } }),
    prisma.player.deleteMany({ where: { id: { in: players } } }),
    prisma.user.deleteMany({ where: { id: { in: users } } }),
  ]);
}

async function seedFixture() {
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
      rosterSize: 4,
      benchSize: 0,
      maxTeams: 3,
      pickSeconds: 60,
      allowAutoPick: true,
      positionLimitsJson: '{}',
      autoPickRulesJson: '{}',
      draftType: DraftType.SNAKE,
      pickOrder: PickOrder.MANUAL,
      waiverRule: WaiverRule.WEEKLY,
      timeZone: 'Australia/Melbourne',
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Raw SQL',
      inviteCode: 'INTRAWSQ',
      ownerId: users[0],
      settingsId: SETTINGS,
      categoriesJson: '[]',
    },
  });
  await prisma.leagueMember.createMany({
    data: members.map((id, index) => ({
      id,
      leagueId: LEAGUE,
      userId: users[index],
      role: index === 0 ? LeagueRole.OWNER : LeagueRole.MANAGER,
      teamName: `Team ${index + 1}`,
      draftSlot: index + 1,
    })),
  });
  await prisma.draft.create({
    data: {
      id: DRAFT,
      leagueId: LEAGUE,
      status: DraftStatus.COMPLETED,
      currentPick: 3,
      totalPicks: 3,
      round: 1,
      direction: DraftDirection.FORWARD,
    },
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

const submit = (index: number, bidAmount?: number) =>
  store().submitClaim({
    leagueId: LEAGUE,
    userId: users[index],
    teamId: members[index],
    playerId: players[index],
    priority: 1,
    bidAmount,
    waiverSettings: bidAmount === undefined ? { system: 'PRIORITY' } : FAAB,
  });

// Claims are read one by one: loadPendingClaims only returns claims whose waiver period has ended.
const waiverOrder = async (claimIds: string[]) =>
  (await Promise.all(claimIds.map((id) => store().loadClaim(LEAGUE, id))))
    .sort((left, right) => (left?.waiverPriority ?? 0) - (right?.waiverPriority ?? 0))
    .map((pending) => pending?.teamId);

const submitAll = async () => {
  const ids: string[] = [];
  for (const index of [0, 1, 2]) ids.push((await submit(index)).id);
  return ids;
};

beforeEach(async () => {
  await removeFixture();
  await seedFixture();
});

afterAll(removeFixture);

describe('waiver claim store', () => {
  it('seeds waiver order from the draft, last pick first', async () => {
    await prisma.pick.createMany({
      data: [0, 1, 2].map((index) => ({
        draftId: DRAFT,
        overall: index + 1,
        round: 1,
        slot: index + 1,
        memberId: members[index],
        playerId: players[index],
      })),
    });
    const ids = await submitAll();

    expect(await waiverOrder(ids)).toEqual([members[2], members[1], members[0]]);
  });

  it('reserves a pending bid against the budget and releases it on cancel', async () => {
    const first = await submit(0, 60);
    await expect(submit(0, 50)).rejects.toMatchObject({ code: 'INSUFFICIENT_FAAB' });

    await store().cancelPendingClaim({
      leagueId: LEAGUE,
      claimId: first.id,
      claim: claim({ id: first.id, bidAmount: 60 }),
      cancelledBy: users[0],
    });

    await expect(submit(0, 50)).resolves.toMatchObject({ id: expect.any(String) });
    await expect(submit(0, 60)).rejects.toBeInstanceOf(WaiverClaimStoreError);
  });

  it('debits an awarded bid, refuses an unaffordable one and refunds', async () => {
    await submit(0, 0);
    expect(await store().debitFaab(claim({ bidAmount: 70 }), FAAB)).toEqual({ ok: true });
    expect(await store().debitFaab(claim({ bidAmount: 40 }), FAAB)).toEqual({
      ok: false,
      reason: 'Insufficient FAAB',
    });

    await store().refundFaab(claim({ bidAmount: 70 }));
    expect(await store().debitFaab(claim({ bidAmount: 100 }), FAAB)).toEqual({ ok: true });
  });

  it('moves a successful claimant to the bottom of the waiver order', async () => {
    const ids = await submitAll();
    await store().advancePriority(LEAGUE, users[0]);

    expect(await waiverOrder(ids)).toEqual([members[1], members[2], members[0]]);
  });
});

describe('team actions route', () => {
  const url = `http://localhost/api/leagues/${LEAGUE}/actions/${users[0]}`;
  const params = { params: Promise.resolve({ id: LEAGUE, userId: users[0] }) };
  const respond = async (pending: Promise<Response | undefined>) => {
    const response = await pending;
    if (!response) throw new Error('Route returned no response');
    return response;
  };
  const post = (body: unknown) =>
    respond(POST(new NextRequest(url, { method: 'POST', body: JSON.stringify(body) }), params));
  const list = async () =>
    (await (await respond(GET(new NextRequest(url), params))).json()).data.actions;

  beforeEach(() => vi.mocked(getAuthenticatedUserId).mockResolvedValue(users[0]));

  it('lists the member’s own actions newest first, including ones written outside the route', async () => {
    await prisma.teamAction.create({
      data: {
        leagueId: LEAGUE,
        memberId: members[0],
        actionType: 'TRADE_PROPOSAL',
        details: '{}',
        createdAt: new Date(Date.now() - 60_000),
      },
    });
    await prisma.teamAction.create({
      data: { leagueId: LEAGUE, memberId: members[1], actionType: 'TRADE_PROPOSAL', details: '{}' },
    });
    const created = await post({
      actionType: 'WAIVER_CLAIM',
      details: { playerId: players[3], dropPlayerId: players[0] },
    });
    expect(created.status).toBe(200);

    const actions = await list();
    expect(actions.map((action: { actionType: string }) => action.actionType)).toEqual([
      'WAIVER_CLAIM',
      'TRADE_PROPOSAL',
    ]);
    expect(actions[0]).toMatchObject({
      status: 'PENDING',
      details: { playerId: players[3], dropPlayerId: players[0] },
    });
  });

  it('removes a dropped player at once and rejects the action when processing fails', async () => {
    await prisma.leagueRosterPlayer.create({
      data: { leagueId: LEAGUE, memberId: members[0], playerId: players[0] },
    });

    expect(
      (await post({ actionType: 'DROP_PLAYER', details: { playerId: players[0] } })).status
    ).toBe(200);

    expect(
      await prisma.leagueRosterPlayer.count({ where: { leagueId: LEAGUE, memberId: members[0] } })
    ).toBe(0);
    const [drop] = await list();
    expect(drop).toMatchObject({ actionType: 'DROP_PLAYER', status: 'REJECTED' });
    expect(drop.processedAt).not.toBeNull();
  });
});

describe('draft pick claim', () => {
  it('claims nothing without a live draft, then claims and persists the next version', async () => {
    expect(
      await prisma.$transaction((tx) => draftTransactionPatterns.claimNextPick(tx, LEAGUE))
    ).toEqual({ claimed: false });

    await prisma.draft.update({
      where: { id: DRAFT },
      data: { status: DraftStatus.LIVE, currentPick: 1 },
    });
    const first = await prisma.$transaction((tx) =>
      draftTransactionPatterns.claimNextPick(tx, LEAGUE)
    );
    const second = await prisma.$transaction((tx) =>
      draftTransactionPatterns.claimNextPick(tx, LEAGUE)
    );

    expect(first).toMatchObject({ claimed: true, draftId: DRAFT, nextPickNumber: 2 });
    expect(second.newVersion).toBe((first.newVersion ?? 0) + 1);
  });
});
