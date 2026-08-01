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

const FIXTURE = {
  leagueId: 'integration-full-draft-league',
  draftId: 'integration-full-draft-draft',
  settingsId: 'integration-full-draft-settings',
  teamCount: 12,
  rosterSize: 22,
  totalPicks: 264,
  playerCount: 280,
} as const;

const userIds = Array.from(
  { length: FIXTURE.teamCount },
  (_, index) => `integration-full-draft-user-${index + 1}`
);
const memberIds = Array.from(
  { length: FIXTURE.teamCount },
  (_, index) => `integration-full-draft-member-${index + 1}`
);
const playerIds = Array.from(
  { length: FIXTURE.playerCount },
  (_, index) => `integration-full-draft-player-${String(index + 1).padStart(3, '0')}`
);
const queuedPlayerId = playerIds.at(-1)!;

async function removeFixture(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.leagueRosterPlayer.deleteMany({ where: { leagueId: FIXTURE.leagueId } });
    await tx.waiverPriority.deleteMany({ where: { leagueId: FIXTURE.leagueId } });
    await tx.leagueRoster.deleteMany({ where: { leagueId: FIXTURE.leagueId } });
    await tx.preDraftQueue.deleteMany({ where: { draftId: FIXTURE.draftId } });
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

async function seedFixture(): Promise<void> {
  const startedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.user.createMany({
      data: userIds.map((id, index) => ({
        id,
        email: `integration-full-draft-${index + 1}@statly.local`,
        passwordHash: 'integration-only',
        displayName: `Integration Manager ${index + 1}`,
        timeZone: 'Australia/Melbourne',
      })),
    });

    await tx.player.createMany({
      data: playerIds.map((id, index) => ({
        id,
        name: `000 Integration Player ${String(index + 1).padStart(3, '0')}`,
        club: 'Integration FC',
        position: '000',
        active: true,
      })),
    });

    await tx.leagueSettings.create({
      data: {
        id: FIXTURE.settingsId,
        rosterSize: FIXTURE.rosterSize,
        benchSize: 0,
        maxTeams: FIXTURE.teamCount,
        pickSeconds: 60,
        allowAutoPick: true,
        positionLimitsJson: JSON.stringify({}),
        autoPickRulesJson: JSON.stringify({ enabled: true, strategy: 'queue-first' }),
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
        name: 'Integration Full Draft League',
        inviteCode: 'INTFULL1',
        ownerId: userIds[0],
        settingsId: FIXTURE.settingsId,
        categoriesJson: JSON.stringify([]),
        createdAt: startedAt,
      },
    });

    await tx.leagueMember.createMany({
      data: memberIds.map((id, index) => ({
        id,
        leagueId: FIXTURE.leagueId,
        userId: userIds[index],
        role: index === 0 ? LeagueRole.OWNER : LeagueRole.MANAGER,
        teamName: `Integration Team ${index + 1}`,
        draftSlot: index + 1,
        joinedAt: startedAt,
      })),
    });

    await tx.draft.create({
      data: {
        id: FIXTURE.draftId,
        leagueId: FIXTURE.leagueId,
        status: DraftStatus.LIVE,
        currentPick: 1,
        totalPicks: FIXTURE.totalPicks,
        round: 1,
        direction: DraftDirection.FORWARD,
        lobbyStatus: 'LIVE',
        lobbyOpenAt: startedAt,
        startedAt,
        pickStartedAt: startedAt,
        pickDeadlineAt: new Date(startedAt.getTime() + 60_000),
      },
    });

    await tx.draftOrder.createMany({
      data: memberIds.map((memberId, index) => ({
        draftId: FIXTURE.draftId,
        memberId,
        slot: index + 1,
      })),
    });

    await tx.preDraftQueue.create({
      data: {
        draftId: FIXTURE.draftId,
        memberId: memberIds[0],
        playerId: queuedPlayerId,
        rank: 1,
      },
    });
  });
}

function expectedMemberId(overall: number): string {
  const round = Math.ceil(overall / FIXTURE.teamCount);
  const roundOffset = (overall - 1) % FIXTURE.teamCount;
  const slot = round % 2 === 1 ? roundOffset + 1 : FIXTURE.teamCount - roundOffset;
  return memberIds[slot - 1];
}

describe('full draft persistence convergence', () => {
  beforeAll(async () => {
    await removeFixture();
    await seedFixture();
  });

  afterAll(async () => {
    await removeFixture();
  });

  it('persists 264 ordered picks and projects one canonical 22-player roster per member', async () => {
    const waiverAvailabilityProjection = {
      projectLeague: vi.fn(async () => ({
        owned: FIXTURE.totalPicks,
        available: FIXTURE.playerCount - FIXTURE.totalPicks,
      })),
    };
    const rosterProjectionService = new RosterProjectionService(
      prisma,
      waiverAvailabilityProjection
    );
    const service = new DraftApplicationService(rosterProjectionService);
    const selectedPlayerIds: string[] = [];

    for (let overall = 1; overall <= FIXTURE.totalPicks; overall += 1) {
      const result = await service.autoPick({
        draftId: FIXTURE.draftId,
        actorUserId: userIds[0],
      });

      selectedPlayerIds.push(result.data.pick.player.id);
      expect(result.currentPick).toBe(overall + 1);
      expect(result.data.schedulingVersion).toBe(overall);
      expect(result.isComplete).toBe(overall === FIXTURE.totalPicks);
      expect(result.events).toEqual(
        overall === FIXTURE.totalPicks
          ? ['draft:auto-pick', 'draft:completed']
          : ['draft:auto-pick']
      );
    }

    expect(waiverAvailabilityProjection.projectLeague).toHaveBeenCalledTimes(1);
    expect(waiverAvailabilityProjection.projectLeague).toHaveBeenCalledWith({
      leagueId: FIXTURE.leagueId,
    });
    expect(selectedPlayerIds[0]).toBe(queuedPlayerId);
    expect(new Set(selectedPlayerIds)).toHaveLength(FIXTURE.totalPicks);
    expect(selectedPlayerIds.every((playerId) => playerIds.includes(playerId))).toBe(true);

    const [draft, picks, rosterOwnership, rosterShells, waiverPriorities, queueCount, events] =
      await Promise.all([
        prisma.draft.findUniqueOrThrow({ where: { id: FIXTURE.draftId } }),
        prisma.pick.findMany({
          where: { draftId: FIXTURE.draftId },
          orderBy: { overall: 'asc' },
        }),
        prisma.leagueRosterPlayer.findMany({
          where: { leagueId: FIXTURE.leagueId },
          orderBy: [{ memberId: 'asc' }, { acquiredAt: 'asc' }],
        }),
        prisma.leagueRoster.findMany({ where: { leagueId: FIXTURE.leagueId } }),
        prisma.waiverPriority.findMany({
          where: { leagueId: FIXTURE.leagueId },
          orderBy: { priority: 'asc' },
        }),
        prisma.preDraftQueue.count({ where: { draftId: FIXTURE.draftId } }),
        prisma.draftEvent.findMany({
          where: { draftId: FIXTURE.draftId },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

    expect(draft).toMatchObject({
      status: DraftStatus.COMPLETED,
      currentPick: FIXTURE.totalPicks + 1,
      schedulingVersion: FIXTURE.totalPicks,
      pickStartedAt: null,
      pickDeadlineAt: null,
      pausedRemainingSeconds: null,
    });
    expect(draft.completedAt).toBeInstanceOf(Date);

    expect(picks).toHaveLength(FIXTURE.totalPicks);
    expect(new Set(picks.map((pick) => pick.playerId))).toHaveLength(FIXTURE.totalPicks);
    for (const pick of picks) {
      expect(pick.auto).toBe(true);
      expect(pick.memberId).toBe(expectedMemberId(pick.overall));
      expect(pick.round).toBe(Math.ceil(pick.overall / FIXTURE.teamCount));
    }

    expect(rosterOwnership).toHaveLength(FIXTURE.totalPicks);
    expect(rosterShells).toHaveLength(FIXTURE.teamCount);
    expect(rosterOwnership.every((row) => row.acquiredBy === 'DRAFT')).toBe(true);
    expect(rosterOwnership.every((row) => row.draftId === FIXTURE.draftId)).toBe(true);
    expect(rosterOwnership.every((row) => row.pickId !== null)).toBe(true);

    const ownershipCountByMember = new Map<string, number>();
    for (const row of rosterOwnership) {
      ownershipCountByMember.set(row.memberId, (ownershipCountByMember.get(row.memberId) ?? 0) + 1);
    }
    expect([...ownershipCountByMember.values()]).toEqual(
      Array.from({ length: FIXTURE.teamCount }, () => FIXTURE.rosterSize)
    );

    expect(queueCount).toBe(0);
    expect(waiverPriorities).toHaveLength(FIXTURE.teamCount);
    expect(waiverPriorities.map((entry) => entry.priority)).toEqual(
      Array.from({ length: FIXTURE.teamCount }, (_, index) => index + 1)
    );
    expect(events.filter((event) => event.event === 'draft:auto-pick')).toHaveLength(
      FIXTURE.totalPicks
    );
    expect(events.filter((event) => event.event === 'draft:completed')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ event: 'draft:completed', publishState: true });

    const unownedFixturePlayers = playerIds.filter(
      (playerId) => !rosterOwnership.some((row) => row.playerId === playerId)
    );
    expect(unownedFixturePlayers).toHaveLength(FIXTURE.playerCount - FIXTURE.totalPicks);
  }, 180_000);
});
