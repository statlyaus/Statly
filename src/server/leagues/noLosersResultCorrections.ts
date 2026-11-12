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

export type CorrectedResultRun = {
  rounds: CorrectedResultRound[];
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
 * and reported, and that league's later rounds wait for the next run; other leagues still run.
 */
export async function rescoreCorrectedResultRounds(
  recalculate: typeof recalculateLeagueRoundMatchups = recalculateLeagueRoundMatchups
): Promise<CorrectedResultRun> {
  const run: CorrectedResultRun = { rounds: [], failedLeagueIds: [] };
  for (const { leagueId, round, corrections } of await findRoundsScoredOnCorrectedResults()) {
    if (run.failedLeagueIds.includes(leagueId)) continue;
    const resultCorrections = [...corrections.values()];
    try {
      const result = await recalculate({ leagueId, round, finalize: false, resultCorrections });
      if (!result) continue; // The league was deleted after the rounds were read.
      if ('blocked' in result) throw new Error(result.blocked);
      // Nothing written (e.g. the stats feed is down): the round still names the corrected result and
      // is retried next run, but this run did not apply the correction, so it must not report success.
      if (result.recalculated === 0) throw new Error('Re-score wrote no matchup scores');
      run.rounds.push({
        leagueId,
        round,
        status: result.status,
        recalculated: result.recalculated,
        correctedResultIds: resultCorrections.map((correction) => correction.supersededResultId),
      });
      logger.info('Re-scored a No Losers round after an AFL result correction', {
        leagueId,
        round,
        status: result.status,
        correctedResultIds: resultCorrections.map((correction) => correction.supersededResultId),
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
