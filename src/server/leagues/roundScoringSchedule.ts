import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getRoundMatches } from '@/server/etl/etlRoundData';

import { normalizeRoundMatchStatus, type RawRoundMatch } from './liveStatsAdapter';
import { recalculateLeagueRoundMatchups } from './matchupReadModel';

export interface ScheduledRoundScoringLeague {
  leagueId: string;
  rounds: Array<{ round: number; status: 'SCHEDULED' | 'LIVE' | 'FINAL'; recalculated: number }>;
  /** Set when a round failed or was refused; later rounds of this league wait for the next run. */
  error?: string;
}

/**
 * Hours after a round's last AFL match starts (or after the round starts, when no match times are
 * known) that the round may stay unscored before a run reports it as stalled. A match lasts about three
 * hours and the ETL loads its stats within a few more, so 12 hours leaves room for a slow load while
 * still alerting the morning after a round that cannot be scored.
 */
export const STALLED_ROUND_GRACE_HOURS = 12;

/**
 * A started round that is still not scored past the grace period because its stats or match status are
 * unavailable, usually a lineup player without totals (no reviewed Footywire link, or the ETL never
 * loaded them). Every run reports it again until it is scored.
 */
export interface StalledLeagueRound {
  leagueId: string;
  /** The AFL season year of the competition round. */
  season: number | null;
  round: number;
  status: 'SCHEDULED' | 'LIVE';
  /** When the grace period ended. */
  stalledSince: string;
  /** Lineup players with no stat totals, when the scoring service reported them. */
  missingPlayerIds: string[];
}

export interface ScheduledRoundScoringRun {
  leagues: ScheduledRoundScoringLeague[];
  failedLeagueIds: string[];
  stalledRounds: StalledLeagueRound[];
}

/**
 * Gives a published round its official start time once the AFL fixture for it has been loaded.
 *
 * Publication reads the fixture once and is never repeated, so a competition published before the
 * fixture was ingested keeps rounds with no start time, which the scoring job below never selects.
 * Only rounds still waiting for fixture data (PENDING, no start time) on the league's current
 * fixture version are filled in, with the same earliest-start rule and SCHEDULED status that
 * publication uses. A round whose AFL matches are not loaded yet stays pending.
 */
export async function fillPendingRoundStartTimes(): Promise<number> {
  const pendingRounds = await prisma.leagueCompetitionRound.findMany({
    where: {
      status: 'PENDING',
      startsAt: null,
      aflRound: { not: null },
      league: {
        settings: { competitionRulesVersion: { gt: 0 }, competitionStatus: { not: 'SETUP' } },
      },
    },
    select: {
      id: true,
      fixtureVersion: true,
      aflRound: true,
      season: { select: { year: true } },
      league: { select: { settings: { select: { competitionRulesVersion: true } } } },
    },
  });

  const startsAtByAflRound = new Map<string, Date | null>();
  let filled = 0;
  for (const competitionRound of pendingRounds) {
    const { aflRound } = competitionRound;
    const year = competitionRound.season?.year;
    if (
      aflRound === null ||
      year == null ||
      competitionRound.fixtureVersion !== competitionRound.league.settings.competitionRulesVersion
    ) {
      continue;
    }
    const key = `${year}:${aflRound}`;
    if (!startsAtByAflRound.has(key)) {
      const matches = await getRoundMatches(year, aflRound);
      startsAtByAflRound.set(
        key,
        normalizeRoundMatchStatus(matches as unknown as RawRoundMatch[]).earliestStartAt
      );
    }
    const startsAt = startsAtByAflRound.get(key);
    if (!startsAt) continue;

    await prisma.$transaction([
      prisma.leagueCompetitionRound.updateMany({
        where: { id: competitionRound.id, status: 'PENDING', startsAt: null },
        data: { status: 'SCHEDULED', startsAt },
      }),
      prisma.leagueMatchup.updateMany({
        where: { competitionRoundId: competitionRound.id, startsAt: null },
        data: { startsAt },
      }),
    ]);
    filled += 1;
  }

  if (filled > 0) logger.info('Filled in official round start times', { rounds: filled });
  return filled;
}

/**
 * Rescores every round of a published competition that has started and is not FINAL, after filling
 * in the start times of rounds published before the AFL fixture was loaded.
 *
 * It calls the same recalculation as the commissioner route, always with `finalize: false`, so a round
 * becomes FINAL only when `recalculateLeagueRoundMatchups` itself decides it: every AFL match of the
 * round is final and every matchup with two teams was scored. Rerunning it rewrites the same scores,
 * and FINAL rounds are never selected again.
 *
 * A round that stays unscored because its stats are unavailable is not a league failure (later rounds
 * still score), but once it is past `STALLED_ROUND_GRACE_HOURS` it is returned in `stalledRounds` and
 * logged as an error, so the cron run reports a failure instead of a success.
 */
export async function scoreStartedLeagueRounds(
  now = new Date(),
  recalculate: typeof recalculateLeagueRoundMatchups = recalculateLeagueRoundMatchups
): Promise<ScheduledRoundScoringRun> {
  await fillPendingRoundStartTimes();

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
      startsAt: true,
      season: { select: { year: true } },
      fixtureVersion: true,
      league: { select: { settings: { select: { competitionRulesVersion: true } } } },
    },
    orderBy: [{ leagueId: 'asc' }, { round: 'asc' }],
  });

  const roundsByLeagueId = new Map<
    string,
    Array<{ round: number; startsAt: Date | null; season: number | null }>
  >();
  for (const competitionRound of startedRounds) {
    // Recalculation reads the league's current fixture version only.
    if (
      competitionRound.fixtureVersion !== competitionRound.league.settings.competitionRulesVersion
    ) {
      continue;
    }
    const rounds = roundsByLeagueId.get(competitionRound.leagueId) ?? [];
    rounds.push({
      round: competitionRound.round,
      startsAt: competitionRound.startsAt,
      season: competitionRound.season?.year ?? null,
    });
    roundsByLeagueId.set(competitionRound.leagueId, rounds);
  }

  const leagues: ScheduledRoundScoringLeague[] = [];
  const stalledRounds: StalledLeagueRound[] = [];
  // One league at a time, so a failure in one league never stops the others.
  for (const [leagueId, rounds] of roundsByLeagueId) {
    const league: ScheduledRoundScoringLeague = { leagueId, rounds: [] };
    leagues.push(league);
    for (const { round, startsAt, season } of rounds) {
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
        if (result.status !== 'FINAL' && result.roundStatus.hasUnavailableStatus) {
          const stalledSince = stalledRoundDeadline(startsAt, result.roundStatus.matches);
          if (stalledSince && stalledSince <= now) {
            const stalled: StalledLeagueRound = {
              leagueId,
              season,
              round,
              status: result.status,
              stalledSince: stalledSince.toISOString(),
              missingPlayerIds: ('missingPlayerIds' in result && result.missingPlayerIds) || [],
            };
            stalledRounds.push(stalled);
            logger.error('Scheduled round scoring is stalled for a league round', { ...stalled });
          }
        }
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
    stalledRounds,
  };
}

/** The end of the grace period: after the last known match start, else after the round start. */
function stalledRoundDeadline(
  roundStartsAt: Date | null,
  matches: ReadonlyArray<{ startsAt: Date | null }>
): Date | null {
  const lastMatchStart = Math.max(
    ...matches.flatMap((match) => (match.startsAt ? [match.startsAt.getTime()] : []))
  );
  const base = Number.isFinite(lastMatchStart) ? lastMatchStart : roundStartsAt?.getTime();
  return base === undefined ? null : new Date(base + STALLED_ROUND_GRACE_HOURS * 60 * 60 * 1000);
}
