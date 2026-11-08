import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

import { recalculateLeagueRoundMatchups } from './matchupReadModel';

export interface ScheduledRoundScoringLeague {
  leagueId: string;
  rounds: Array<{ round: number; status: 'SCHEDULED' | 'LIVE' | 'FINAL'; recalculated: number }>;
  /** Set when a round failed or was refused; later rounds of this league wait for the next run. */
  error?: string;
}

export interface ScheduledRoundScoringRun {
  leagues: ScheduledRoundScoringLeague[];
  failedLeagueIds: string[];
}

/**
 * Rescores every round of a published competition that has started and is not FINAL.
 *
 * It calls the same recalculation as the commissioner route, always with `finalize: false`, so a round
 * becomes FINAL only when `recalculateLeagueRoundMatchups` itself decides it: every AFL match of the
 * round is final and every matchup with two teams was scored. Rerunning it rewrites the same scores,
 * and FINAL rounds are never selected again.
 */
export async function scoreStartedLeagueRounds(
  now = new Date(),
  recalculate: typeof recalculateLeagueRoundMatchups = recalculateLeagueRoundMatchups
): Promise<ScheduledRoundScoringRun> {
  const startedRounds = await prisma.leagueCompetitionRound.findMany({
    where: {
      status: { notIn: ['FINAL', 'NO_MATCHUP'] },
      // A round with no official start time stays pending; the job never guesses one.
      startsAt: { lte: now },
      league: {
        settings: { competitionRulesVersion: { gt: 0 }, competitionStatus: { not: 'SETUP' } },
      },
    },
    select: {
      leagueId: true,
      round: true,
      fixtureVersion: true,
      league: { select: { settings: { select: { competitionRulesVersion: true } } } },
    },
    orderBy: [{ leagueId: 'asc' }, { round: 'asc' }],
  });

  const roundsByLeagueId = new Map<string, number[]>();
  for (const competitionRound of startedRounds) {
    // Recalculation reads the league's current fixture version only.
    if (
      competitionRound.fixtureVersion !== competitionRound.league.settings.competitionRulesVersion
    ) {
      continue;
    }
    const rounds = roundsByLeagueId.get(competitionRound.leagueId) ?? [];
    rounds.push(competitionRound.round);
    roundsByLeagueId.set(competitionRound.leagueId, rounds);
  }

  const leagues: ScheduledRoundScoringLeague[] = [];
  // One league at a time, so a failure in one league never stops the others.
  for (const [leagueId, rounds] of roundsByLeagueId) {
    const league: ScheduledRoundScoringLeague = { leagueId, rounds: [] };
    leagues.push(league);
    for (const round of rounds) {
      try {
        const result = await recalculate({ leagueId, round, finalize: false });
        if (!result) break; // The league was deleted after the rounds were read.
        if ('blocked' in result) {
          // See docs/runbooks/unscored-finalized-matchups.md.
          league.error = result.blocked;
          logger.error('Scheduled round scoring failed for a league', {
            leagueId,
            round,
            error: result.blocked,
            unscoredMatchupIds: result.unscoredMatchupIds,
          });
          break;
        }
        league.rounds.push({ round, status: result.status, recalculated: result.recalculated });
      } catch (error) {
        league.error = error instanceof Error ? error.message : String(error);
        logger.error('Scheduled round scoring failed for a league', {
          leagueId,
          round,
          error: league.error,
        });
        break;
      }
    }
  }

  return {
    leagues,
    failedLeagueIds: leagues.flatMap((league) => (league.error ? [league.leagueId] : [])),
  };
}
