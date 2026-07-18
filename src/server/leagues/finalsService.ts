import 'server-only';

import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

import {
  advanceFinalsBracket,
  type FinalsBracketKey,
  type FinalsTeamCount,
} from './finalsProgression';

export async function synchronizeFinalsFixtures({
  leagueId,
  fixtureVersion,
  finalsTeams,
  orderedRegularSeasonMemberIds,
}: {
  leagueId: string;
  fixtureVersion: number;
  finalsTeams: FinalsTeamCount;
  orderedRegularSeasonMemberIds: readonly string[];
}) {
  const finalsFixtures = await prisma.leagueMatchup.findMany({
    where: { leagueId, fixtureVersion, phase: 'FINALS', bracketKey: { not: null } },
    orderBy: [{ round: 'asc' }, { createdAt: 'asc' }],
  });
  if (!finalsFixtures.length) return { updated: 0 };

  const finalizedOutcomes = finalsFixtures.flatMap((fixture) => {
    if (
      fixture.status !== 'FINAL' ||
      !fixture.bracketKey ||
      !fixture.homeMemberId ||
      !fixture.awayMemberId
    ) {
      return [];
    }
    return [
      {
        bracketKey: fixture.bracketKey as FinalsBracketKey,
        homeMemberId: fixture.homeMemberId,
        awayMemberId: fixture.awayMemberId,
        homeCategoryWins: fixture.homeCategoryWins,
        awayCategoryWins: fixture.awayCategoryWins,
      },
    ];
  });
  const assignments = advanceFinalsBracket({
    finalsTeams,
    orderedRegularSeasonMemberIds,
    finalizedOutcomes,
  });
  let updated = 0;

  await prisma.$transaction(async (tx) => {
    for (const assignment of assignments) {
      const fixture = finalsFixtures.find(
        (candidate) => candidate.bracketKey === assignment.bracketKey
      );
      if (!fixture || fixture.status === 'FINAL' || fixture.homeMemberId || fixture.awayMemberId) {
        continue;
      }

      const update = await tx.leagueMatchup.updateMany({
        where: {
          id: fixture.id,
          status: 'SCHEDULED',
          homeMemberId: null,
          awayMemberId: null,
        },
        data: {
          homeMemberId: assignment.homeMemberId,
          awayMemberId: assignment.awayMemberId,
        },
      });
      updated += update.count;
    }

    if (updated > 0) {
      await tx.leagueCompetitionAudit.create({
        data: {
          leagueId,
          eventType: 'FINALS_RESEEDED',
          payloadJson: JSON.stringify({ fixtureVersion, assignments, updated }),
        },
      });
    }
  });

  if (updated > 0) {
    void import('@/lib/activity')
      .then(({ logLeagueActivity }) =>
        logLeagueActivity(leagueId, 'competition-finals-updated', {
          fixtureVersion,
          updated,
        })
      )
      .catch((error: unknown) => {
        logger.warn('Failed to record finals progression activity', {
          leagueId,
          fixtureVersion,
          error,
        });
      });
  }

  return { updated };
}
