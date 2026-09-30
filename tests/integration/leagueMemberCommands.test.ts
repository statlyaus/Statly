import {
  DraftDirection,
  DraftStatus,
  DraftType,
  LeagueRole,
  PickOrder,
  WaiverRule,
} from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { canManageLeague, getLeagueMembership } from '@/lib/leagueMembership';
import { prisma } from '@/lib/prisma';
import { ensureLeagueDraftSetupConverged } from '@/server/draft/services/DraftSetupConvergenceService';
import {
  hasDraftStarted,
  removeLeagueMember,
  transferLeagueOwnership,
  updateLeagueMember,
} from '@/server/leagues/memberCommands';

const FIXTURE = {
  leagueId: 'integration-member-commands-league',
  draftId: 'integration-member-commands-draft',
  settingsId: 'integration-member-commands-settings',
} as const;

const userIds = ['owner', 'alpha', 'bravo', 'charlie'].map(
  (name) => `integration-member-commands-${name}`
);
const memberIds = userIds.map((userId) => `${userId}-member`);
const [ownerUserId, alphaUserId, bravoUserId, charlieUserId] = userIds;

async function removeFixture(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.draftOrder.deleteMany({ where: { draftId: FIXTURE.draftId } });
    await tx.draft.deleteMany({ where: { leagueId: FIXTURE.leagueId } });
    await tx.leagueMember.deleteMany({ where: { leagueId: FIXTURE.leagueId } });
    await tx.league.deleteMany({ where: { id: FIXTURE.leagueId } });
    await tx.leagueSettings.deleteMany({ where: { id: FIXTURE.settingsId } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });
}

async function seedFixture(): Promise<void> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.user.createMany({
      data: userIds.map((id) => ({
        id,
        email: `${id}@statly.local`,
        passwordHash: 'integration-only',
        displayName: id,
        timeZone: 'Australia/Melbourne',
      })),
    });
    await tx.leagueSettings.create({
      data: {
        id: FIXTURE.settingsId,
        rosterSize: 2,
        benchSize: 0,
        maxTeams: 4,
        pickSeconds: 60,
        allowAutoPick: true,
        positionLimitsJson: JSON.stringify({}),
        autoPickRulesJson: JSON.stringify({ enabled: true, strategy: 'queue-first' }),
        draftType: DraftType.SNAKE,
        pickOrder: PickOrder.MANUAL,
        waiverRule: WaiverRule.WEEKLY,
        startAt: now,
        timeZone: 'Australia/Melbourne',
      },
    });
    await tx.league.create({
      data: {
        id: FIXTURE.leagueId,
        name: 'Integration Member Commands League',
        inviteCode: 'INTMEMB1',
        ownerId: ownerUserId,
        settingsId: FIXTURE.settingsId,
        categoriesJson: JSON.stringify([]),
      },
    });
    await tx.leagueMember.createMany({
      data: memberIds.map((id, index) => ({
        id,
        leagueId: FIXTURE.leagueId,
        userId: userIds[index],
        role: index === 0 ? LeagueRole.OWNER : LeagueRole.MANAGER,
        teamName: `Team ${index + 1}`,
        draftSlot: index + 1,
        joinedAt: now,
      })),
    });
    await tx.draft.create({
      data: {
        id: FIXTURE.draftId,
        leagueId: FIXTURE.leagueId,
        status: DraftStatus.SCHEDULED,
        currentPick: 1,
        totalPicks: 8,
        round: 1,
        direction: DraftDirection.FORWARD,
      },
    });
    await tx.draftOrder.createMany({
      data: memberIds.map((memberId, index) => ({
        draftId: FIXTURE.draftId,
        memberId,
        slot: index + 1,
      })),
    });
  });
}

async function draftOrder(): Promise<Array<{ memberId: string; slot: number }>> {
  return prisma.draftOrder.findMany({
    where: { draftId: FIXTURE.draftId },
    orderBy: { slot: 'asc' },
    select: { memberId: true, slot: true },
  });
}

describe('league member commands', () => {
  beforeEach(async () => {
    await removeFixture();
    await seedFixture();
  });

  afterAll(async () => {
    await removeFixture();
  });

  it('lets the owner remove a manager before the draft and closes the gap in the draft order', async () => {
    const result = await removeLeagueMember({
      leagueId: FIXTURE.leagueId,
      actorUserId: ownerUserId,
      targetUserId: bravoUserId,
    });

    expect(result).toEqual({
      ok: true,
      data: { removedUserId: bravoUserId, memberCount: 3 },
    });

    const removed = await prisma.leagueMember.findUniqueOrThrow({
      where: { id: memberIds[2] },
    });
    expect(removed).toMatchObject({ isActive: false, status: 'removed', draftSlot: null });
    expect(removed.leftAt).toBeInstanceOf(Date);

    expect(await draftOrder()).toEqual([
      { memberId: memberIds[0], slot: 1 },
      { memberId: memberIds[1], slot: 2 },
      { memberId: memberIds[3], slot: 3 },
    ]);
    const remainingSlots = await prisma.leagueMember.findMany({
      where: { leagueId: FIXTURE.leagueId, isActive: true },
      orderBy: { draftSlot: 'asc' },
      select: { id: true, draftSlot: true },
    });
    expect(remainingSlots).toEqual([
      { id: memberIds[0], draftSlot: 1 },
      { id: memberIds[1], draftSlot: 2 },
      { id: memberIds[3], draftSlot: 3 },
    ]);
  });

  it('keeps a removed member out of the draft when draft setup converges again', async () => {
    await removeLeagueMember({
      leagueId: FIXTURE.leagueId,
      actorUserId: ownerUserId,
      targetUserId: alphaUserId,
    });

    await prisma.draftOrder.deleteMany({ where: { draftId: FIXTURE.draftId } });
    await ensureLeagueDraftSetupConverged({ leagueId: FIXTURE.leagueId });

    const order = await draftOrder();
    expect(order.map((row) => row.memberId)).toEqual([memberIds[0], memberIds[2], memberIds[3]]);
  });

  it('revokes league access and management from a removed manager', async () => {
    expect((await getLeagueMembership(FIXTURE.leagueId, bravoUserId)).isMember).toBe(true);

    await removeLeagueMember({
      leagueId: FIXTURE.leagueId,
      actorUserId: ownerUserId,
      targetUserId: bravoUserId,
    });

    expect(await getLeagueMembership(FIXTURE.leagueId, bravoUserId)).toMatchObject({
      isMember: false,
    });
    expect(await canManageLeague(FIXTURE.leagueId, bravoUserId)).toBe(false);
    expect((await getLeagueMembership(FIXTURE.leagueId, ownerUserId)).isMember).toBe(true);
  });

  it('refuses removal once the draft room is live, even before the first pick', async () => {
    await prisma.draft.update({ where: { id: FIXTURE.draftId }, data: { lobbyStatus: 'LIVE' } });

    const result = await removeLeagueMember({
      leagueId: FIXTURE.leagueId,
      actorUserId: ownerUserId,
      targetUserId: bravoUserId,
    });

    expect(result).toMatchObject({ ok: false, code: 'draft-started' });
  });

  it('keeps removal open while the lobby is only counting down to the start', () => {
    expect(
      hasDraftStarted({
        status: DraftStatus.SCHEDULED,
        startedAt: null,
        lobbyStatus: 'COUNTDOWN',
        _count: { picks: 0 },
      })
    ).toBe(false);
  });

  it('lets a manager leave before the draft', async () => {
    const result = await removeLeagueMember({
      leagueId: FIXTURE.leagueId,
      actorUserId: charlieUserId,
      targetUserId: charlieUserId,
    });

    expect(result.ok).toBe(true);
  });

  it('refuses removal by a manager who is not the owner', async () => {
    const result = await removeLeagueMember({
      leagueId: FIXTURE.leagueId,
      actorUserId: alphaUserId,
      targetUserId: bravoUserId,
    });

    expect(result).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await draftOrder()).toHaveLength(4);
  });

  it('refuses to remove the owner', async () => {
    const result = await removeLeagueMember({
      leagueId: FIXTURE.leagueId,
      actorUserId: ownerUserId,
      targetUserId: ownerUserId,
    });

    expect(result).toMatchObject({ ok: false, code: 'owner-cannot-be-removed' });
  });

  it('refuses removal once the draft has started', async () => {
    await prisma.draft.update({
      where: { id: FIXTURE.draftId },
      data: { status: DraftStatus.LIVE, startedAt: new Date() },
    });

    const result = await removeLeagueMember({
      leagueId: FIXTURE.leagueId,
      actorUserId: ownerUserId,
      targetUserId: bravoUserId,
    });

    expect(result).toMatchObject({ ok: false, code: 'draft-started' });
    const member = await prisma.leagueMember.findUniqueOrThrow({ where: { id: memberIds[2] } });
    expect(member.isActive).toBe(true);
  });

  it('reports an unknown league without touching another league', async () => {
    const result = await removeLeagueMember({
      leagueId: 'integration-member-commands-missing',
      actorUserId: ownerUserId,
      targetUserId: bravoUserId,
    });

    expect(result).toMatchObject({ ok: false, code: 'league-not-found' });
  });

  it('transfers ownership to an active member and demotes the previous owner', async () => {
    const result = await transferLeagueOwnership({
      leagueId: FIXTURE.leagueId,
      actorUserId: ownerUserId,
      targetUserId: alphaUserId,
    });

    expect(result).toEqual({ ok: true, data: { ownerUserId: alphaUserId } });
    const league = await prisma.league.findUniqueOrThrow({ where: { id: FIXTURE.leagueId } });
    expect(league.ownerId).toBe(alphaUserId);
    const roles = await prisma.leagueMember.findMany({
      where: { id: { in: [memberIds[0], memberIds[1]] } },
      orderBy: { id: 'asc' },
      select: { id: true, role: true },
    });
    expect(Object.fromEntries(roles.map((row) => [row.id, row.role]))).toEqual({
      [memberIds[0]]: LeagueRole.MANAGER,
      [memberIds[1]]: LeagueRole.OWNER,
    });
  });

  it('refuses ownership transfer from a non-owner or to a removed member', async () => {
    expect(
      await transferLeagueOwnership({
        leagueId: FIXTURE.leagueId,
        actorUserId: alphaUserId,
        targetUserId: bravoUserId,
      })
    ).toMatchObject({ ok: false, code: 'forbidden' });

    await removeLeagueMember({
      leagueId: FIXTURE.leagueId,
      actorUserId: ownerUserId,
      targetUserId: bravoUserId,
    });

    expect(
      await transferLeagueOwnership({
        leagueId: FIXTURE.leagueId,
        actorUserId: ownerUserId,
        targetUserId: bravoUserId,
      })
    ).toMatchObject({ ok: false, code: 'member-not-found' });
  });

  it('lets a manager rename their own team and rejects a name another team uses', async () => {
    expect(
      await updateLeagueMember({
        leagueId: FIXTURE.leagueId,
        actorUserId: alphaUserId,
        targetUserId: alphaUserId,
        teamName: '  Alpha Aces  ',
      })
    ).toMatchObject({ ok: true, data: { teamName: 'Alpha Aces', role: 'member' } });

    expect(
      await updateLeagueMember({
        leagueId: FIXTURE.leagueId,
        actorUserId: bravoUserId,
        targetUserId: bravoUserId,
        teamName: 'alpha aces',
      })
    ).toMatchObject({ ok: false, code: 'team-name-taken' });
  });

  it('lets only the owner make a manager co-commissioner, and not change the owner', async () => {
    expect(
      await updateLeagueMember({
        leagueId: FIXTURE.leagueId,
        actorUserId: alphaUserId,
        targetUserId: bravoUserId,
        role: 'admin',
      })
    ).toMatchObject({ ok: false, code: 'forbidden' });

    expect(
      await updateLeagueMember({
        leagueId: FIXTURE.leagueId,
        actorUserId: ownerUserId,
        targetUserId: bravoUserId,
        role: 'admin',
      })
    ).toMatchObject({ ok: true, data: { role: 'admin' } });
    const bravo = await prisma.leagueMember.findUniqueOrThrow({ where: { id: memberIds[2] } });
    expect(bravo.isCoCommissioner).toBe(true);

    expect(
      await updateLeagueMember({
        leagueId: FIXTURE.leagueId,
        actorUserId: alphaUserId,
        targetUserId: alphaUserId,
        role: 'admin',
      })
    ).toMatchObject({ ok: true, data: { role: 'member' } });
    expect(
      (await prisma.leagueMember.findUniqueOrThrow({ where: { id: memberIds[1] } }))
        .isCoCommissioner
    ).toBe(false);

    expect(
      await updateLeagueMember({
        leagueId: FIXTURE.leagueId,
        actorUserId: ownerUserId,
        targetUserId: ownerUserId,
        role: 'member',
      })
    ).toMatchObject({ ok: true, data: { role: 'owner' } });
  });

  it('refuses to update a removed member', async () => {
    await removeLeagueMember({
      leagueId: FIXTURE.leagueId,
      actorUserId: ownerUserId,
      targetUserId: charlieUserId,
    });

    expect(
      await updateLeagueMember({
        leagueId: FIXTURE.leagueId,
        actorUserId: ownerUserId,
        targetUserId: charlieUserId,
        teamName: 'Back Again',
      })
    ).toMatchObject({ ok: false, code: 'member-not-found' });
  });
});
