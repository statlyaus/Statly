import { prisma } from '@/lib/prisma';

import type { DevFixtureScenarioManifest, DevFixtureStepResult } from '../core/types';

export async function ensureFixtureRosters(input: {
  manifest: DevFixtureScenarioManifest;
  leagueIds: string[];
}): Promise<DevFixtureStepResult[]> {
  const rosterSize = input.manifest.rosterSize + input.manifest.benchSize;
  const requiredPlayers = input.manifest.teamsPerLeague * rosterSize;
  const players = await prisma.player.findMany({
    where: { active: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: requiredPlayers,
    select: { id: true },
  });

  if (players.length < requiredPlayers) {
    return [
      {
        name: 'rosters',
        status: 'failed',
        detail: `Need ${requiredPlayers} active players; found ${players.length}.`,
      },
    ];
  }

  const steps: DevFixtureStepResult[] = [];

  for (const leagueId of input.leagueIds) {
    const members = await prisma.leagueMember.findMany({
      where: { leagueId },
      orderBy: [{ draftSlot: 'asc' }, { joinedAt: 'asc' }],
      select: { id: true },
    });

    await prisma.$transaction(async (tx) => {
      for (const [memberIndex, member] of members.entries()) {
        await tx.leagueRoster.upsert({
          where: {
            leagueId_memberId: {
              leagueId,
              memberId: member.id,
            },
          },
          create: {
            leagueId,
            memberId: member.id,
          },
          update: {},
        });

        await tx.leagueRosterPlayer.deleteMany({
          where: {
            leagueId,
            memberId: member.id,
          },
        });

        const offset = memberIndex * rosterSize;
        const rosterPlayers = players.slice(offset, offset + rosterSize);
        for (const [sortOrder, player] of rosterPlayers.entries()) {
          await tx.leagueRosterPlayer.create({
            data: {
              leagueId,
              memberId: member.id,
              playerId: player.id,
              sortOrder,
            },
          });
        }
      }
    });

    steps.push({
      name: `rosters ${leagueId}`,
      status: 'updated',
      detail: `Ensured ${members.length} rosters with ${rosterSize} players each.`,
    });
  }

  return steps;
}
