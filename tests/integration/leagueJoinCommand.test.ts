import {
  DraftDirection,
  DraftStatus,
  DraftType,
  LeagueRole,
  PickOrder,
  PrismaClient,
  WaiverRule,
} from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { findPrismaLeagueIdByInviteCode, joinLeague } from '@/server/leagues/memberCommands';

const FIXTURE = {
  leagueId: 'integration-join-command-league',
  draftId: 'integration-join-command-draft',
  settingsId: 'integration-join-command-settings',
  inviteCode: 'INTJOIN1',
} as const;

const userIds = ['owner', 'alpha', 'bravo', 'charlie', 'delta'].map(
  (name) => `integration-join-command-${name}`
);
const [ownerUserId, alphaUserId, bravoUserId, charlieUserId, deltaUserId] = userIds;
const memberIds = [ownerUserId, alphaUserId, bravoUserId].map((userId) => `${userId}-member`);

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

/**
 * Three-team league: the owner and alpha are active, bravo was removed and keeps a history row.
 * Charlie and delta have never used Statly, so they have no Prisma user row yet.
 */
async function seedFixture(): Promise<void> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.user.createMany({
      data: [ownerUserId, alphaUserId, bravoUserId].map((id) => ({
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
        maxTeams: 3,
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
        name: 'Integration Join League',
        inviteCode: FIXTURE.inviteCode,
        ownerId: ownerUserId,
        settingsId: FIXTURE.settingsId,
        categoriesJson: JSON.stringify([]),
      },
    });
    await tx.leagueMember.createMany({
      data: [
        {
          id: memberIds[0],
          leagueId: FIXTURE.leagueId,
          userId: ownerUserId,
          role: LeagueRole.OWNER,
          teamName: 'Team 1',
          draftSlot: 1,
          joinedAt: now,
        },
        {
          id: memberIds[1],
          leagueId: FIXTURE.leagueId,
          userId: alphaUserId,
          role: LeagueRole.MANAGER,
          teamName: 'Team 2',
          draftSlot: 2,
          joinedAt: now,
        },
        {
          id: memberIds[2],
          leagueId: FIXTURE.leagueId,
          userId: bravoUserId,
          role: LeagueRole.MANAGER,
          teamName: 'Team 3',
          draftSlot: null,
          joinedAt: now,
          leftAt: now,
          isActive: false,
          status: 'removed',
        },
      ],
    });
    await tx.draft.create({
      data: {
        id: FIXTURE.draftId,
        leagueId: FIXTURE.leagueId,
        status: DraftStatus.SCHEDULED,
        lobbyStatus: 'COUNTDOWN',
        currentPick: 1,
        totalPicks: 4,
        round: 1,
        direction: DraftDirection.FORWARD,
      },
    });
    await tx.draftOrder.createMany({
      data: [memberIds[0], memberIds[1]].map((memberId, index) => ({
        draftId: FIXTURE.draftId,
        memberId,
        slot: index + 1,
      })),
    });
  });
}

async function activeMembers() {
  return prisma.leagueMember.findMany({
    where: { leagueId: FIXTURE.leagueId, isActive: true },
    orderBy: { draftSlot: 'asc' },
    select: { id: true, userId: true, draftSlot: true, teamName: true },
  });
}

async function draftOrderUserIds(): Promise<string[]> {
  const rows = await prisma.draftOrder.findMany({
    where: { draftId: FIXTURE.draftId },
    orderBy: { slot: 'asc' },
    select: { member: { select: { userId: true } } },
  });
  return rows.map((row) => row.member.userId);
}

function join(userId: string, teamName?: string) {
  return joinLeague({ leagueId: FIXTURE.leagueId, userId, teamName });
}

describe('league join command', () => {
  beforeEach(async () => {
    await removeFixture();
    await seedFixture();
  });

  afterAll(async () => {
    await removeFixture();
  });

  it('finds a Prisma league by its normalised invite code', async () => {
    expect(await findPrismaLeagueIdByInviteCode(FIXTURE.inviteCode)).toBe(FIXTURE.leagueId);
    expect(await findPrismaLeagueIdByInviteCode('NOSUCHCODE')).toBeNull();
  });

  it('gives the slot freed by a removed team to a new manager and extends the draft order', async () => {
    const result = await join(charlieUserId, 'Charlie FC');

    expect(result).toMatchObject({
      ok: true,
      data: {
        memberCount: 3,
        draftSlot: 3,
        member: {
          leagueId: FIXTURE.leagueId,
          userId: charlieUserId,
          role: 'member',
          teamName: 'Charlie FC',
          isActive: true,
        },
        league: { id: FIXTURE.leagueId, name: 'Integration Join League' },
      },
    });
    expect((await activeMembers()).map((member) => member.userId)).toEqual([
      ownerUserId,
      alphaUserId,
      charlieUserId,
    ]);
    expect(await draftOrderUserIds()).toEqual([ownerUserId, alphaUserId, charlieUserId]);
    expect(await prisma.user.findUnique({ where: { id: charlieUserId } })).not.toBeNull();
  });

  it('refuses a join once every slot is taken', async () => {
    expect((await join(charlieUserId, 'Charlie FC')).ok).toBe(true);

    const result = await join(deltaUserId, 'Delta FC');

    expect(result).toMatchObject({ ok: false, code: 'league-full' });
    expect(
      await prisma.leagueMember.findFirst({
        where: { leagueId: FIXTURE.leagueId, userId: deltaUserId },
      })
    ).toBeNull();
  });

  it('admits exactly one of two managers racing for the last slot', async () => {
    // Separate clients hold separate database connections, as separate web processes would.
    const racers = [new PrismaClient(), new PrismaClient()];
    const results = await Promise.all([
      joinLeague(
        { leagueId: FIXTURE.leagueId, userId: charlieUserId, teamName: 'Charlie FC' },
        racers[0]
      ),
      joinLeague(
        { leagueId: FIXTURE.leagueId, userId: deltaUserId, teamName: 'Delta FC' },
        racers[1]
      ),
    ]).finally(() => Promise.all(racers.map((racer) => racer.$disconnect())));

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({ ok: false, code: 'league-full' }),
    ]);
    expect(await activeMembers()).toHaveLength(3);
    expect(await draftOrderUserIds()).toHaveLength(3);
  });

  it('reactivates a removed manager who rejoins, reusing their history row and old name', async () => {
    const result = await join(bravoUserId, 'Team 3');

    expect(result).toMatchObject({
      ok: true,
      data: { member: { id: memberIds[2], teamName: 'Team 3' }, draftSlot: 3 },
    });
    const bravo = await prisma.leagueMember.findUniqueOrThrow({ where: { id: memberIds[2] } });
    expect(bravo).toMatchObject({ isActive: true, status: 'ACTIVE', leftAt: null, draftSlot: 3 });
    expect(
      await prisma.leagueMember.count({
        where: { leagueId: FIXTURE.leagueId, userId: bravoUserId },
      })
    ).toBe(1);
  });

  it('refuses a manager who is already active in the league', async () => {
    expect(await join(alphaUserId, 'Alpha Again')).toMatchObject({
      ok: false,
      code: 'already-member',
    });
  });

  it('refuses a team name another active team already uses, ignoring case', async () => {
    expect(await join(charlieUserId, ' team 2 ')).toMatchObject({
      ok: false,
      code: 'team-name-taken',
    });
  });

  it('names the team after the league when no name is given', async () => {
    const result = await join(charlieUserId, '   ');

    expect(result).toMatchObject({
      ok: true,
      data: { member: { teamName: 'Integration Join League Team 3' } },
    });
  });

  it('closes joining once the draft has started', async () => {
    await prisma.draft.update({
      where: { id: FIXTURE.draftId },
      data: { status: DraftStatus.LIVE, startedAt: new Date() },
    });

    expect(await join(charlieUserId, 'Charlie FC')).toMatchObject({
      ok: false,
      code: 'draft-started',
    });
    expect(await activeMembers()).toHaveLength(2);
  });

  it('reports an unknown league', async () => {
    expect(
      await joinLeague({ leagueId: 'integration-join-command-missing', userId: charlieUserId })
    ).toMatchObject({ ok: false, code: 'league-not-found' });
  });
});
