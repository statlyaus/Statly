import { formatLeagueTime } from '@/lib/leagueTime';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

import { publishLeagueSystemMessage } from './social/socialSystemEvents';

// Telling the league a bite was granted (#1343). The grant itself is written inside the scoring
// transaction (`syncBloodsuckerBites`) with an audit row only, so nobody was told. This posts one
// league activity message per grant after that transaction commits. No `server-only` import: the
// scoring read model reaches it.

const FAILED = 'Bloodsucker bite grant activity message failed';
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Posts one activity message for each open bite of a scored round. A message is keyed by bite and
 * `grantedScoreVersion`, so a bite already announced posts nothing, a reactivated grant posts once
 * more, and a message that failed is posted by the next scoring run of that round. Best effort: it
 * never throws, because scoring has already committed.
 */
export async function publishBiteGrantActivity(input: {
  leagueId: string;
  seasonId: string;
  round: number;
}): Promise<void> {
  const { leagueId, seasonId, round } = input;
  try {
    const bites = await prisma.leagueBite.findMany({
      where: { leagueId, seasonId, round, status: 'OPEN' },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        matchupId: true,
        bloodsuckerMemberId: true,
        victimMemberId: true,
        grantedScoreVersion: true,
        deadlineAt: true,
      },
    });
    if (!bites.length) return;

    const [victims, matchups, settings] = await Promise.all([
      prisma.leagueMember.findMany({
        where: { leagueId, id: { in: bites.map((bite) => bite.victimMemberId) } },
        select: { id: true, teamName: true },
      }),
      prisma.leagueMatchup.findMany({
        where: { leagueId, id: { in: bites.map((bite) => bite.matchupId) } },
        select: {
          id: true,
          status: true,
          winnerMemberId: true,
          homeMemberId: true,
          homeCategoryWins: true,
          awayCategoryWins: true,
        },
      }),
      prisma.leagueSettings.findFirst({
        where: { league: { id: leagueId } },
        select: { timeZone: true },
      }),
    ]);

    for (const bite of bites) {
      const team =
        victims.find((member) => member.id === bite.victimMemberId)?.teamName ?? 'their opponent';
      const matchup = matchups.find((row) => row.id === bite.matchupId);
      // A bite whose matchup a re-score sent back from FINAL waits (E5): nothing to announce yet.
      if (matchup?.status !== 'FINAL' || matchup.winnerMemberId !== bite.bloodsuckerMemberId) {
        continue;
      }
      const score =
        matchup.homeMemberId === bite.bloodsuckerMemberId
          ? `${matchup.homeCategoryWins}-${matchup.awayCategoryWins}`
          : `${matchup.awayCategoryWins}-${matchup.homeCategoryWins}`;
      const deadline = formatLeagueTime(bite.deadlineAt, settings?.timeZone ?? undefined);
      try {
        await publishLeagueSystemMessage({
          leagueId,
          eventType: 'BLOODSUCKER_BITE_GRANTED',
          relatedEntityId: `${bite.id}:grant:${bite.grantedScoreVersion}`,
          content:
            `The Bloodsucker beat ${team} ${score} in round ${round} and has a bite to make. ` +
            `If it has not chosen by ${deadline}, the system makes the pick.`,
          context: { biteId: bite.id, round, deadlineAt: bite.deadlineAt.toISOString() },
        });
      } catch (error) {
        logger.warn(FAILED, { leagueId, biteId: bite.id, error: errorText(error) });
      }
    }
  } catch (error) {
    logger.warn(FAILED, { leagueId, round, error: errorText(error) });
  }
}
