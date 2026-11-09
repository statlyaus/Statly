import {
  DraftDirection,
  DraftStatus,
  DraftType,
  LeagueRole,
  PickOrder,
  WaiverRule,
} from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/lib/prisma';
import { DraftApplicationService } from '@/server/draft/services/DraftApplicationService';
import { RosterProjectionService } from '@/server/rosters/RosterProjectionService';
import { activateLeagueSeason } from './helpers/leagueSeason';

// The final pick and its roster projection are one transaction: a projection failure rolls the
// pick and the draft completion back, so the draft stays LIVE and the pick can be retried.
const FIXTURE = {
  leagueId: 'integration-completion-projection-league',
  draftId: 'integration-completion-projection-draft',
  settingsId: 'integration-completion-projection-settings',
} as const;
const userIds = ['integration-completion-user-1', 'integration-completion-user-2'];
const memberIds = ['integration-completion-member-1', 'integration-completion-member-2'];
const playerIds = ['integration-completion-player-1', 'integration-completion-player-2'];

async function removeFixture(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.leagueRosterPlayer.deleteMany({ where: { leagueId: FIXTURE.leagueId } });
    await tx.waiverPriority.deleteMany({ where: { leagueId: FIXTURE.leagueId } });
    await tx.draftEvent.deleteMany({ where: { draftId: FIXTURE.draftId } });
    await tx.pick.deleteMany({ where: { draftId: FIXTURE.draftId } });
    await tx.draftOrder.deleteMany({ where: { draftId: FIXTURE.draftId } });
    await tx.draft.deleteMany({ where: { id: FIXTURE.draftId } });
    await tx.leagueMember.deleteMany({ where: { leagueId: FIXTURE.leagueId } });
    await tx.league.deleteMany({ where: { id: FIXTURE.leagueId } });
    await tx.leagueSettings.deleteMany({ where: { id: FIXTURE.settingsId } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
    await tx.player.deleteMany({ where: { id: { in: playerIds } } });
  });
}

// Two teams, one roster spot each, pick 1 already made: the next pick completes the draft. The
// league starts with no active season, so seeding waiver priority inside the projection fails.
async function seedFixture(): Promise<void> {
  const startedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.user.createMany({
      data: userIds.map((id, index) => ({
        id,
        email: `integration-completion-${index + 1}@statly.local`,
        passwordHash: 'integration-only',
        displayName: `Integration Completion ${index + 1}`,
        timeZone: 'Australia/Melbourne',
      })),
    });
    await tx.player.createMany({
      data: playerIds.map((id, index) => ({
        id,
        name: `000 Integration Completion Player ${index + 1}`,
        club: 'Integration FC',
        position: '000',
        active: true,
      })),
    });
    await tx.leagueSettings.create({
      data: {
        id: FIXTURE.settingsId,
        rosterSize: 1,
        benchSize: 0,
        maxTeams: 2,
        pickSeconds: 60,
        allowAutoPick: true,
        positionLimitsJson: {},
        autoPickRulesJson: { enabled: true, strategy: 'queue-first' },
        draftType: DraftType.SNAKE,
        pickOrder: PickOrder.MANUAL,
        waiverRule: WaiverRule.WEEKLY,
        startAt: startedAt,
        timeZone: 'Australia/Melbourne',
        locked: true,
      },
    });
    await tx.league.create({
      data: {
        id: FIXTURE.leagueId,
        name: 'Integration Completion Projection League',
        inviteCode: 'INTCMPL1',
        ownerId: userIds[0],
        settingsId: FIXTURE.settingsId,
        categoriesJson: [],
        createdAt: startedAt,
      },
    });
    await tx.leagueMember.createMany({
      data: memberIds.map((id, index) => ({
        id,
        leagueId: FIXTURE.leagueId,
        userId: userIds[index],
        role: index === 0 ? LeagueRole.OWNER : LeagueRole.MANAGER,
        teamName: `Integration Completion Team ${index + 1}`,
        draftSlot: index + 1,
        joinedAt: startedAt,
      })),
    });
    await tx.draft.create({
      data: {
        id: FIXTURE.draftId,
        leagueId: FIXTURE.leagueId,
        status: DraftStatus.LIVE,
        currentPick: 2,
        totalPicks: 2,
        round: 1,
        direction: DraftDirection.FORWARD,
        lobbyStatus: 'LIVE',
        lobbyOpenAt: startedAt,
        startedAt,
        pickStartedAt: startedAt,
        pickDeadlineAt: new Date(startedAt.getTime() + 60_000),
        schedulingVersion: 1,
      },
    });
    await tx.draftOrder.createMany({
      data: memberIds.map((memberId, index) => ({
        draftId: FIXTURE.draftId,
        memberId,
        slot: index + 1,
      })),
    });
    await tx.pick.create({
      data: {
        draftId: FIXTURE.draftId,
        overall: 1,
        round: 1,
        slot: 1,
        memberId: memberIds[0],
        playerId: playerIds[0],
        auto: false,
      },
    });
  });
}

describe('draft completion roster projection', () => {
  const waiverAvailabilityProjection = { projectLeague: vi.fn(async () => ({})) };
  const service = new DraftApplicationService(
    new RosterProjectionService(prisma, waiverAvailabilityProjection as never)
  );

  beforeAll(async () => {
    await removeFixture();
    await seedFixture();
  });

  afterAll(async () => {
    await removeFixture();
  });

  it('rolls the final pick and the draft completion back when the roster projection fails', async () => {
    await expect(
      service.makePick({
        draftId: FIXTURE.draftId,
        actorUserId: userIds[1],
        playerId: playerIds[1],
      })
    ).rejects.toThrow(/has no active season/);

    const [draft, pickCount, rosterCount, priorityCount] = await Promise.all([
      prisma.draft.findUniqueOrThrow({ where: { id: FIXTURE.draftId } }),
      prisma.pick.count({ where: { draftId: FIXTURE.draftId } }),
      prisma.leagueRosterPlayer.count({ where: { leagueId: FIXTURE.leagueId } }),
      prisma.waiverPriority.count({ where: { leagueId: FIXTURE.leagueId } }),
    ]);
    expect(draft).toMatchObject({
      status: DraftStatus.LIVE,
      currentPick: 2,
      schedulingVersion: 1,
      completedAt: null,
    });
    expect(pickCount).toBe(1);
    expect(rosterCount).toBe(0);
    expect(priorityCount).toBe(0);
    expect(waiverAvailabilityProjection.projectLeague).not.toHaveBeenCalled();
  });

  it('commits rosters and waiver priority with the completed draft once the retry succeeds', async () => {
    await activateLeagueSeason(prisma, FIXTURE.leagueId);

    const result = await service.makePick({
      draftId: FIXTURE.draftId,
      actorUserId: userIds[1],
      playerId: playerIds[1],
    });
    expect(result.isComplete).toBe(true);

    const [draft, roster, priorities] = await Promise.all([
      prisma.draft.findUniqueOrThrow({ where: { id: FIXTURE.draftId } }),
      prisma.leagueRosterPlayer.findMany({
        where: { leagueId: FIXTURE.leagueId },
        orderBy: { memberId: 'asc' },
      }),
      prisma.waiverPriority.findMany({
        where: { leagueId: FIXTURE.leagueId },
        orderBy: { priority: 'asc' },
      }),
    ]);
    expect(draft.status).toBe(DraftStatus.COMPLETED);
    expect(
      roster.map(({ memberId, playerId, acquiredBy, draftId }) => ({
        memberId,
        playerId,
        acquiredBy,
        draftId,
      }))
    ).toEqual([
      {
        memberId: memberIds[0],
        playerId: playerIds[0],
        acquiredBy: 'DRAFT',
        draftId: FIXTURE.draftId,
      },
      {
        memberId: memberIds[1],
        playerId: playerIds[1],
        acquiredBy: 'DRAFT',
        draftId: FIXTURE.draftId,
      },
    ]);
    // Reverse final-pick order: the member who picked last gets priority 1.
    expect(priorities.map(({ memberId, priority }) => ({ memberId, priority }))).toEqual([
      { memberId: memberIds[1], priority: 1 },
      { memberId: memberIds[0], priority: 2 },
    ]);
    expect(waiverAvailabilityProjection.projectLeague).toHaveBeenCalledTimes(1);
    expect(waiverAvailabilityProjection.projectLeague).toHaveBeenCalledWith({
      leagueId: FIXTURE.leagueId,
    });
  });
});
