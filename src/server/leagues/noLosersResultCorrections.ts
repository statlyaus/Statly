import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

import type { ResultCorrection } from './finalRoundRescoreAudit';
import { recalculateLeagueRoundMatchups } from './matchupReadModel';

/**
 * No Losers result corrections (#1295, epic #1290 BR-23). The results ingest never rewrites a stored
 * `AflMatchResult`: a changed result supersedes it (BR-24). A per-player score
 * (`LeagueMatchupPlayerScore`) that still names a superseded row was scored on a result that is no
 * longer official, so its round is re-scored through the same recalculation the scoring job and the
 * commissioner use. That path records every change to a FINAL matchup as a `FINAL_ROUND_RESCORED`
 * audit row (#1288); here it is written with no actor (system) and `trigger: 'result-correction'`.
 *
 * After a re-score the round's player rows name the current results, so nothing is selected again:
 * an unchanged re-ingest supersedes nothing and triggers nothing. Only the league's active season and
 * current fixture version are re-scored, as the recalculation itself reads only those.
 */
export type CorrectedResultRound = {
  leagueId: string;
  round: number;
  status: 'SCHEDULED' | 'LIVE' | 'FINAL';
  recalculated: number;
  /** The superseded `AflMatchResult` rows the round had been scored on. */
  correctedResultIds: string[];
};

/**
 * A round the recalculation could not re-score yet, with no error: its stats are unavailable, or it
 * has no scorable matchup. Nothing was written, so it is selected again on the next run (#1315).
 */
export type PendingCorrectedResultRound = {
  leagueId: string;
  round: number;
  correctedResultIds: string[];
};

export type CorrectedResultRun = {
  rounds: CorrectedResultRound[];
  pending: PendingCorrectedResultRound[];
  failedLeagueIds: string[];
};

type PendingRound = { leagueId: string; round: number; corrections: Map<string, ResultCorrection> };

/** League rounds whose stored player scores name a superseded result, oldest round first. */
export async function findRoundsScoredOnCorrectedResults(): Promise<PendingRound[]> {
  const rows = await prisma.leagueMatchupPlayerScore.findMany({
    where: { aflMatchResult: { supersededById: { not: null } } },
    select: {
      leagueId: true,
      seasonId: true,
      round: true,
      matchup: { select: { fixtureVersion: true } },
      league: {
        select: {
          activeSeasonId: true,
          settings: { select: { competitionRulesVersion: true } },
        },
      },
      aflMatchResult: { select: { id: true, supersededById: true, supersedeReason: true } },
    },
  });

  const rounds = new Map<string, PendingRound>();
  for (const row of rows) {
    const result = row.aflMatchResult;
    if (
      !result?.supersededById ||
      row.seasonId !== row.league.activeSeasonId ||
      row.matchup.fixtureVersion !== row.league.settings.competitionRulesVersion
    ) {
      continue;
    }
    const key = `${row.leagueId}:${row.round}`;
    const pending = rounds.get(key) ?? {
      leagueId: row.leagueId,
      round: row.round,
      corrections: new Map(),
    };
    pending.corrections.set(result.id, {
      supersededResultId: result.id,
      // The replacement may itself be superseded since; the audit names the row that replaced it.
      currentResultId: result.supersededById,
      reason: result.supersedeReason ?? '',
    });
    rounds.set(key, pending);
  }
  return [...rounds.values()].sort(
    (a, b) => a.leagueId.localeCompare(b.leagueId) || a.round - b.round
  );
}

/**
 * Re-scores every round scored on a corrected result. One league's failure (or refusal) is logged
 * and reported, and that league's later rounds wait for the next run; other leagues still run. A
 * round the recalculation could not re-score (nothing recalculated) is reported as pending, not as
 * re-scored, and is not logged per run: the scoring job's summary carries the count.
 */
export async function rescoreCorrectedResultRounds(
  recalculate: typeof recalculateLeagueRoundMatchups = recalculateLeagueRoundMatchups
): Promise<CorrectedResultRun> {
  const run: CorrectedResultRun = { rounds: [], pending: [], failedLeagueIds: [] };
  for (const { leagueId, round, corrections } of await findRoundsScoredOnCorrectedResults()) {
    if (run.failedLeagueIds.includes(leagueId)) continue;
    const resultCorrections = [...corrections.values()];
    try {
      const result = await recalculate({ leagueId, round, finalize: false, resultCorrections });
      if (!result) continue; // The league was deleted after the rounds were read.
      if ('blocked' in result) throw new Error(result.blocked);
      const correctedResultIds = resultCorrections.map(
        (correction) => correction.supersededResultId
      );
      if (result.recalculated === 0) {
        run.pending.push({ leagueId, round, correctedResultIds });
        continue;
      }
      run.rounds.push({
        leagueId,
        round,
        status: result.status,
        recalculated: result.recalculated,
        correctedResultIds,
      });
      logger.info('Re-scored a No Losers round after an AFL result correction', {
        leagueId,
        round,
        status: result.status,
        correctedResultIds,
      });
    } catch (error) {
      run.failedLeagueIds.push(leagueId);
      logger.error('Failed to re-score a No Losers round after an AFL result correction', {
        leagueId,
        round,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return run;
}
