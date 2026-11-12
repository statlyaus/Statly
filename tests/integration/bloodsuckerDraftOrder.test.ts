/**
 * BR-09 and BR-10 (#1279): the Bloodsucker is never in the draft order, on any path that builds or
 * rebuilds it, and keeps a stable draft slot after the drafters for ordering only.
 */
import { DraftDirection, DraftStatus, DraftType, LeagueRole, PickOrder } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { prisma } from '@/lib/prisma';
import { calculateDraftTurn } from '@/server/draft/domain/draftRules';
import { ensureLeagueDraftSetupConverged } from '@/server/draft/services/DraftSetupConvergenceService';
import { joinLeague, removeLeagueMember } from '@/server/leagues/memberCommands';

const LEAGUE = 'int-bs-order-league';
const SETTINGS = 'int-bs-order-settings';
const DRAFT = 'int-bs-order-draft';
const userIds = Array.from({ length: 13 }, (_, index) => `int-bs-order-user-${index + 1}`);
const memberIds = userIds.map((id) => `${id}-member`);
// The Bloodsucker sits mid-order (slot 3), so excluding it must close the gap.
const BLOODSUCKER = memberIds[2];
const ROSTER_SPOTS = 2;
// Enough MIDs for 12 rosters, so the capacity is not capped by the pool.
const playerIds = Array.from({ length: 30 }, (_, index) => `int-bs-order-player-${index + 1}`);

async function removeFixture() {
  await prisma.$transaction(async (tx) => {
    await tx.draftOrder.deleteMany({ where: { draft: { leagueId: LEAGUE } } });
    await tx.draft.deleteMany({ where: { leagueId: LEAGUE } });
    await tx.leagueMember.deleteMany({ where: { leagueId: LEAGUE } });
    await tx.league.deleteMany({ where: { id: LEAGUE } });
    await tx.leagueSettings.deleteMany({ where: { id: SETTINGS } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
    await tx.player.deleteMany({ where: { id: { in: playerIds } } });
  });
}

async function seedFixture(leagueFormat: 'BLOODSUCKER' | 'STANDARD') {
  const now = new Date();
  await prisma.user.createMany({
    data: userIds.map((id) => ({
      id,
      email: `${id}@statly.local`,
      passwordHash: 'x',
      displayName: id,
    })),
  });
  await prisma.player.createMany({
    data: playerIds.map((id) => ({ id, name: id, club: 'Test', position: 'MID', active: true })),
  });
  await prisma.leagueSettings.create({
    data: {
      id: SETTINGS,
      rosterSize: ROSTER_SPOTS,
      benchSize: 0,
      maxTeams: 16,
      pickSeconds: 60,
      allowAutoPick: true,
      positionLimitsJson: { DEF: 0, MID: 2, RUC: 0, FWD: 0, BENCH: 0 },
      draftType: DraftType.SNAKE,
      pickOrder: PickOrder.MANUAL,
      waiverRule: 'ROLLING',
      startAt: new Date(now.getTime() + 86_400_000),
      timeZone: 'Australia/Melbourne',
      leagueFormat,
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Bloodsucker order',
      inviteCode: 'INTBSORD',
      ownerId: userIds[0],
      settingsId: SETTINGS,
    },
  });
  // Twelve members; the thirteenth user joins in a test.
  await prisma.leagueMember.createMany({
    data: memberIds.slice(0, 12).map((id, index) => ({
      id,
      leagueId: LEAGUE,
      userId: userIds[index],
      role: index === 0 ? LeagueRole.OWNER : LeagueRole.MANAGER,
      teamName: `Team ${index + 1}`,
      draftSlot: index + 1,
      joinedAt: new Date(now.getTime() + index),
    })),
  });
  if (leagueFormat === 'BLOODSUCKER') {
    await prisma.leagueSettings.update({
      where: { id: SETTINGS },
      data: { bloodsuckerMemberId: BLOODSUCKER },
    });
  }
}

async function createDraftWithFullOrder() {
  await prisma.draft.create({
    data: {
      id: DRAFT,
      leagueId: LEAGUE,
      status: DraftStatus.SCHEDULED,
      lobbyStatus: 'COUNTDOWN',
      currentPick: 1,
      totalPicks: 24,
      round: 1,
      direction: DraftDirection.FORWARD,
    },
  });
  // A stale order that still holds the Bloodsucker, as a league switched to Bloodsucker would have.
  await prisma.draftOrder.createMany({
    data: memberIds
      .slice(0, 12)
      .map((memberId, index) => ({ draftId: DRAFT, memberId, slot: index + 1 })),
  });
}

const order = () =>
  prisma.draftOrder.findMany({
    where: { draft: { leagueId: LEAGUE } },
    orderBy: { slot: 'asc' },
    select: { memberId: true, slot: true },
  });
const slotOf = async (memberId: string) =>
  (await prisma.leagueMember.findUniqueOrThrow({ where: { id: memberId } })).draftSlot;

function expectContiguousWithoutBloodsucker(rows: Array<{ memberId: string; slot: number }>) {
  expect(rows.map((row) => row.memberId)).not.toContain(BLOODSUCKER);
  expect(rows.map((row) => row.slot)).toEqual(rows.map((_, index) => index + 1));
}

beforeEach(removeFixture);
afterAll(removeFixture);

describe('a Bloodsucker league draft order', () => {
  it('convergence builds an 11-team order without the Bloodsucker, who takes slot 12', async () => {
    await seedFixture('BLOODSUCKER');
    await createDraftWithFullOrder();

    await ensureLeagueDraftSetupConverged({ prismaClient: prisma, leagueId: LEAGUE });

    const rows = await order();
    expect(rows).toHaveLength(11);
    expectContiguousWithoutBloodsucker(rows);
    expect(rows.map((row) => row.memberId)).toEqual(
      memberIds.filter((id, index) => index < 12 && id !== BLOODSUCKER)
    );
    expect(await slotOf(BLOODSUCKER)).toBe(12);
    const draft = await prisma.draft.findUniqueOrThrow({ where: { id: DRAFT } });
    expect(draft.totalPicks).toBe(11 * ROSTER_SPOTS);
  });

  it('convergence creates a new draft room without the Bloodsucker', async () => {
    await seedFixture('BLOODSUCKER');

    await ensureLeagueDraftSetupConverged({ prismaClient: prisma, leagueId: LEAGUE });

    const rows = await order();
    expect(rows).toHaveLength(11);
    expectContiguousWithoutBloodsucker(rows);
  });

  it('snakes over 11 slots per round', async () => {
    await seedFixture('BLOODSUCKER');
    await createDraftWithFullOrder();
    await ensureLeagueDraftSetupConverged({ prismaClient: prisma, leagueId: LEAGUE });
    const participants = (await order()).map((row) => ({
      ...row,
      userId: row.memberId,
      displayName: '',
      role: 'MANAGER',
    }));

    const turn = (pick: number) => calculateDraftTurn('SNAKE', pick, participants);
    expect(turn(11)).toMatchObject({ round: 1, slot: 11 });
    expect(turn(12)).toMatchObject({ round: 2, slot: 11 });
    expect(turn(22)).toMatchObject({ round: 2, slot: 1 });
    expect(turn(23)).toMatchObject({ round: 3, slot: 1 });
  });

  it('a manager leaving rebuilds the order without the Bloodsucker, who stays last', async () => {
    await seedFixture('BLOODSUCKER');
    await createDraftWithFullOrder();

    const result = await removeLeagueMember({
      leagueId: LEAGUE,
      actorUserId: userIds[0],
      targetUserId: userIds[5],
    });

    expect(result.ok).toBe(true);
    const rows = await order();
    expect(rows).toHaveLength(10);
    expectContiguousWithoutBloodsucker(rows);
    expect(await slotOf(BLOODSUCKER)).toBe(11);
  });

  it('a manager joining rebuilds the order without the Bloodsucker, who stays last', async () => {
    await seedFixture('BLOODSUCKER');
    await createDraftWithFullOrder();

    const result = await joinLeague({ leagueId: LEAGUE, userId: userIds[12] });

    expect(result.ok).toBe(true);
    const rows = await order();
    expect(rows).toHaveLength(12);
    expectContiguousWithoutBloodsucker(rows);
    const joined = await prisma.leagueMember.findFirstOrThrow({
      where: { leagueId: LEAGUE, userId: userIds[12] },
    });
    expect(rows.at(-1)?.memberId).toBe(joined.id);
    expect(result.ok && result.data.draftSlot).toBe(12);
    expect(await slotOf(BLOODSUCKER)).toBe(13);
  });
});

describe('a standard league draft order (unchanged)', () => {
  it('convergence keeps every member in the order', async () => {
    await seedFixture('STANDARD');
    await createDraftWithFullOrder();

    await ensureLeagueDraftSetupConverged({ prismaClient: prisma, leagueId: LEAGUE });

    const rows = await order();
    expect(rows.map((row) => row.memberId)).toEqual(memberIds.slice(0, 12));
    expect(await slotOf(BLOODSUCKER)).toBe(3);
  });

  it('join and leave keep every active member in the order', async () => {
    await seedFixture('STANDARD');
    await createDraftWithFullOrder();

    await joinLeague({ leagueId: LEAGUE, userId: userIds[12] });
    await removeLeagueMember({
      leagueId: LEAGUE,
      actorUserId: userIds[0],
      targetUserId: userIds[5],
    });

    const rows = await order();
    expect(rows).toHaveLength(12);
    expect(rows.map((row) => row.slot)).toEqual(rows.map((_, index) => index + 1));
    expect(rows.map((row) => row.memberId)).toContain(BLOODSUCKER);
  });
});
