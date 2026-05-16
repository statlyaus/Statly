import { LeagueRole } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { leagueApplicationService } from '@/server/league/services/LeagueApplicationService';

import type { DevFixtureScenarioManifest, DevFixtureStepResult } from '../core/types';

function getLeagueName(manifest: DevFixtureScenarioManifest, index: number) {
  return `${manifest.leagueNamePrefix} ${index + 1}`;
}

export function getFixtureBotUserId(manifest: DevFixtureScenarioManifest, leagueIndex: number, botIndex: number) {
  return `${manifest.botUserIdPrefix}${leagueIndex + 1}-bot-${botIndex + 1}`;
}

export async function ensureFixtureLeagues(input: {
  manifest: DevFixtureScenarioManifest;
  ownerUserId: string;
}): Promise<{ leagueIds: string[]; steps: DevFixtureStepResult[] }> {
  const leagueIds: string[] = [];
  const steps: DevFixtureStepResult[] = [];
  const draftDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  for (let leagueIndex = 0; leagueIndex < input.manifest.leagueCount; leagueIndex += 1) {
    const name = getLeagueName(input.manifest, leagueIndex);
    let league = await prisma.league.findFirst({
      where: { name },
      select: { id: true },
    });

    if (!league) {
      const created = await leagueApplicationService.createLeague({
        userId: input.ownerUserId,
        name,
        type: 'private',
        maxTeams: input.manifest.teamsPerLeague,
        categories: input.manifest.categories as never,
        description: 'Fixture-owned league for local end-to-end testing.',
        draftDate,
      });
      league = { id: created.id };
      steps.push({ name, status: 'created', detail: `Created fixture league ${created.id}.` });
    } else {
      steps.push({ name, status: 'updated', detail: `Repaired existing fixture league ${league.id}.` });
    }

    await leagueApplicationService.updateLeagueSetup({
      leagueId: league.id,
      actorUserId: input.ownerUserId,
      name,
      type: 'private',
      categories: input.manifest.categories as never,
      draftDate,
      rosterSize: input.manifest.rosterSize,
      benchSize: input.manifest.benchSize,
      timePerPick: 120,
      allowAutoPick: true,
      enableReminders: false,
      seasonWeeks: 12,
      matchupsPerOpponent: 1,
    });

    await prisma.leagueMember.update({
      where: {
        leagueId_userId: {
          leagueId: league.id,
          userId: input.ownerUserId,
        },
      },
      data: {
        role: LeagueRole.OWNER,
        teamName: 'Statly Testers',
        draftSlot: 1,
      },
    });

    leagueIds.push(league.id);
  }

  return { leagueIds, steps };
}

export async function ensureFixtureMembers(input: {
  manifest: DevFixtureScenarioManifest;
  leagueIds: string[];
}) {
  const steps: DevFixtureStepResult[] = [];

  for (const [leagueIndex, leagueId] of input.leagueIds.entries()) {
    const expectedBotUserIds = new Set(
      Array.from({ length: input.manifest.botTeamsPerLeague }, (_, botIndex) =>
        getFixtureBotUserId(input.manifest, leagueIndex, botIndex)
      )
    );
    const staleBotMembers = await prisma.leagueMember.findMany({
      where: {
        leagueId,
        userId: {
          startsWith: input.manifest.botUserIdPrefix,
          notIn: Array.from(expectedBotUserIds),
        },
      },
      select: { id: true },
    });
    const staleBotMemberIds = staleBotMembers.map((member) => member.id);

    if (staleBotMemberIds.length > 0) {
      await prisma.$transaction(async (tx) => {
        await tx.leagueBotProfile.deleteMany({ where: { memberId: { in: staleBotMemberIds } } });
        await tx.leagueRosterPlayerSummary.deleteMany({
          where: { memberId: { in: staleBotMemberIds } },
        });
        await tx.leagueRosterPlayer.deleteMany({ where: { memberId: { in: staleBotMemberIds } } });
        await tx.leagueRoster.deleteMany({ where: { memberId: { in: staleBotMemberIds } } });
        await tx.waiverClaim.deleteMany({ where: { memberId: { in: staleBotMemberIds } } });
        await tx.waiverPriority.deleteMany({ where: { memberId: { in: staleBotMemberIds } } });
        await tx.teamAction.deleteMany({ where: { memberId: { in: staleBotMemberIds } } });
        await tx.draftWatchlist.deleteMany({ where: { memberId: { in: staleBotMemberIds } } });
        await tx.preDraftQueue.deleteMany({ where: { memberId: { in: staleBotMemberIds } } });
        await tx.lobbyActivity.deleteMany({ where: { memberId: { in: staleBotMemberIds } } });
        await tx.draftOrder.deleteMany({ where: { memberId: { in: staleBotMemberIds } } });
        await tx.pick.deleteMany({ where: { memberId: { in: staleBotMemberIds } } });
        await tx.leagueMember.deleteMany({ where: { id: { in: staleBotMemberIds } } });
      });
    }

    for (let botIndex = 0; botIndex < input.manifest.botTeamsPerLeague; botIndex += 1) {
      const userId = getFixtureBotUserId(input.manifest, leagueIndex, botIndex);
      await prisma.user.upsert({
        where: { id: userId },
        create: {
          id: userId,
          email: `${userId}@statly.fixture`,
          displayName: `Fixture Bot ${leagueIndex + 1}-${botIndex + 1}`,
          timeZone: 'Australia/Melbourne',
        },
        update: {
          email: `${userId}@statly.fixture`,
          displayName: `Fixture Bot ${leagueIndex + 1}-${botIndex + 1}`,
          timeZone: 'Australia/Melbourne',
        },
      });

      await prisma.leagueMember.upsert({
        where: {
          leagueId_userId: {
            leagueId,
            userId,
          },
        },
        create: {
          leagueId,
          userId,
          role: LeagueRole.MANAGER,
          teamName: `Fixture Bot ${botIndex + 1}`,
          draftSlot: botIndex + 2,
        },
        update: {
          role: LeagueRole.MANAGER,
          teamName: `Fixture Bot ${botIndex + 1}`,
          draftSlot: botIndex + 2,
        },
      });
    }

    steps.push({
      name: `league ${leagueIndex + 1} members`,
      status: 'updated',
      detail: `Ensured ${input.manifest.teamsPerLeague} fixture members; removed ${staleBotMemberIds.length} stale fixture bot members.`,
    });
  }

  return steps;
}
