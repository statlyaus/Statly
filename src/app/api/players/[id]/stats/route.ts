export const runtime = 'nodejs';

import { type NextRequest } from 'next/server';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { readCanonicalPlayerId } from '@/lib/playerMatchStats';
import { calculateTotalValue, type PlayerStats } from '@/types/fantasyCategories';

function readStatNumber(
  data: Record<string, unknown>,
  key: string,
  fallbackKeys: string[] = []
): number {
  const stats = (data.stats as Record<string, unknown> | undefined) ?? {};
  const raw = (data.raw_row as Record<string, unknown> | undefined) ?? {};

  for (const candidate of [key, ...fallbackKeys]) {
    const value = data[candidate] ?? stats[candidate] ?? raw[candidate];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return 0;
}

export async function GET(_request: NextRequest, context: RouteContext<'/api/players/[id]/stats'>) {
  let playerIdForLog = 'unknown';
  try {
    const { id } = await context.params;
    playerIdForLog = id;
    const playerId = decodeURIComponent(id);

    logger.debug('Fetching stats for player', { playerId });

    let snapshot = await adminDb
      .collection('player_match_stats')
      .where('playerId', '==', playerId)
      .get();

    if (snapshot.empty) {
      snapshot = await adminDb
        .collection('player_match_stats')
        .where('player_id', '==', playerId)
        .get();
    }

    logger.debug('Found player match records', { playerId, recordCount: snapshot.size });

    if (snapshot.empty) {
      return commonErrors.notFound('Player stats not found');
    }

    // Aggregate stats
    let totalGames = 0;
    let totalGoals = 0;
    let totalDisposals = 0;
    let totalMarks = 0;
    let totalTackles = 0;
    let totalKicks = 0;
    let totalHandballs = 0;
    let totalHitouts = 0;
    let totalInside50s = 0;
    let totalRebound50s = 0;
    let totalContested = 0;
    let totalUncontested = 0;
    let totalIntercepts = 0;
    let totalClearances = 0;
    let totalClangers = 0;
    let totalFreesFor = 0;
    let totalFreesAgainst = 0;
    let totalOnePercenters = 0;
    let totalGoalAssists = 0;
    let totalTurnovers = 0;
    let totalMetresGained = 0;
    let totalContestedMarks = 0;
    let totalEffectiveDisposals = 0;
    let totalScoreInvolvements = 0;
    let totalTimeOnGround = 0;
    let totalDisposalEfficiency = 0;
    let latestRound = 0;
    let playerName = '';
    let team = '';
    let position = '';

    snapshot.docs.forEach((doc) => {
      const data = doc.data() as Record<string, unknown>;
      if (readCanonicalPlayerId(data) !== playerId) return;
      totalGames++;

      totalGoals += readStatNumber(data, 'goals');
      totalDisposals += readStatNumber(data, 'disposals');
      totalMarks += readStatNumber(data, 'marks');
      totalTackles += readStatNumber(data, 'tackles');
      totalKicks += readStatNumber(data, 'kicks');
      totalHandballs += readStatNumber(data, 'handballs');
      totalHitouts += readStatNumber(data, 'hitouts', ['hit_outs']);
      totalInside50s += readStatNumber(data, 'inside_50s', ['inside50s']);
      totalRebound50s += readStatNumber(data, 'rebound_50s', ['rebound50s']);
      totalContested += readStatNumber(data, 'contested_possessions', ['contestedPossessions']);
      totalUncontested += readStatNumber(data, 'uncontested_possessions', [
        'uncontestedPossessions',
      ]);
      totalIntercepts += readStatNumber(data, 'intercepts');
      totalClearances += readStatNumber(data, 'clearances');
      totalClangers += readStatNumber(data, 'clangers');
      totalFreesFor += readStatNumber(data, 'frees_for', ['freesFor']);
      totalFreesAgainst += readStatNumber(data, 'frees_against', ['freesAgainst']);
      totalOnePercenters += readStatNumber(data, 'one_percenters', ['onePercenters']);
      totalGoalAssists += readStatNumber(data, 'goal_assists', ['goalAssists']);
      totalTurnovers += readStatNumber(data, 'turnovers');
      totalMetresGained += readStatNumber(data, 'metres_gained', ['metresGained']);
      totalContestedMarks += readStatNumber(data, 'contested_marks', ['contestedMarks']);
      totalEffectiveDisposals += readStatNumber(data, 'effective_disposals', [
        'effectiveDisposals',
      ]);
      totalScoreInvolvements += readStatNumber(data, 'score_involvements', ['scoreInvolvements']);
      totalTimeOnGround += readStatNumber(data, 'time_on_ground_percentage', ['tog_pct']) || 85;
      totalDisposalEfficiency +=
        readStatNumber(data, 'disposal_efficiency', ['disposalEffPct']) || 75;

      latestRound = Math.max(
        latestRound,
        readStatNumber(data, 'round', ['round_number', 'match_round'])
      );

      if (typeof data.player_name === 'string' && data.player_name.trim().length > 0) {
        playerName = data.player_name.trim();
      }
      if (typeof data.team === 'string') team = data.team;
      if (typeof data.position === 'string') position = data.position;
    });

    if (totalGames === 0) {
      return commonErrors.notFound('Player stats not found');
    }

    // Create PlayerStats object for custom scoring calculation
    const aggregatedStats: PlayerStats = {
      games: totalGames,
      kicks: totalKicks,
      handballs: totalHandballs,
      marks: totalMarks,
      tackles: totalTackles,
      goals: totalGoals,
      hitouts: totalHitouts,
      clearances: totalClearances,
      inside50s: totalInside50s,
      rebound50s: totalRebound50s,
      clangers: totalClangers,
      contestedPossessions: totalContested,
      uncontestedPossessions: totalUncontested,
      freesFor: totalFreesFor,
      freesAgainst: totalFreesAgainst,
      onePercenters: totalOnePercenters,
      goalAssists: totalGoalAssists,
      timeOnGroundPct: totalGames > 0 ? totalTimeOnGround / totalGames : 85,
      disposalEffPct: totalGames > 0 ? totalDisposalEfficiency / totalGames : 75,
      turnovers: totalTurnovers,
      intercepts: totalIntercepts,
      metresGained: totalMetresGained,
      contestedMarks: totalContestedMarks,
      effectiveDisposals: totalEffectiveDisposals,
      scoreInvolvements: totalScoreInvolvements,
    };

    // Calculate custom fantasy score using your algorithm
    const customTotalValue = calculateTotalValue(aggregatedStats);
    const customAverageScore = totalGames > 0 ? Math.round(customTotalValue / totalGames) : 0;

    const playerStats = {
      playerName: playerName || playerId,
      team,
      position,
      totalGames,
      averageScore: customAverageScore, // Using custom scoring algorithm
      totalScore: customTotalValue, // Using custom total value
      averagePlayerValue: customAverageScore, // Use same value for consistency
      latestRound,
      averageStats: {
        goals: totalGames > 0 ? Math.round((totalGoals / totalGames) * 10) / 10 : 0,
        disposals: totalGames > 0 ? Math.round((totalDisposals / totalGames) * 10) / 10 : 0,
        marks: totalGames > 0 ? Math.round((totalMarks / totalGames) * 10) / 10 : 0,
        tackles: totalGames > 0 ? Math.round((totalTackles / totalGames) * 10) / 10 : 0,
        kicks: totalGames > 0 ? Math.round((totalKicks / totalGames) * 10) / 10 : 0,
        handballs: totalGames > 0 ? Math.round((totalHandballs / totalGames) * 10) / 10 : 0,
        hitouts: totalGames > 0 ? Math.round((totalHitouts / totalGames) * 10) / 10 : 0,
        inside50s: totalGames > 0 ? Math.round((totalInside50s / totalGames) * 10) / 10 : 0,
        rebound50s: totalGames > 0 ? Math.round((totalRebound50s / totalGames) * 10) / 10 : 0,
        contestedPossessions:
          totalGames > 0 ? Math.round((totalContested / totalGames) * 10) / 10 : 0,
        intercepts: totalGames > 0 ? Math.round((totalIntercepts / totalGames) * 10) / 10 : 0,
        clearances: totalGames > 0 ? Math.round((totalClearances / totalGames) * 10) / 10 : 0,
        clangers: totalGames > 0 ? Math.round((totalClangers / totalGames) * 10) / 10 : 0,
        effectiveDisposals:
          totalGames > 0 ? Math.round((totalEffectiveDisposals / totalGames) * 10) / 10 : 0,
        contestedMarks:
          totalGames > 0 ? Math.round((totalContestedMarks / totalGames) * 10) / 10 : 0,
        metresGained: totalGames > 0 ? Math.round((totalMetresGained / totalGames) * 10) / 10 : 0,
        goalAssists: totalGames > 0 ? Math.round((totalGoalAssists / totalGames) * 10) / 10 : 0,
        scoreInvolvements:
          totalGames > 0 ? Math.round((totalScoreInvolvements / totalGames) * 10) / 10 : 0,
      },
      totalStats: {
        goals: totalGoals,
        disposals: totalDisposals,
        marks: totalMarks,
        tackles: totalTackles,
        kicks: totalKicks,
        handballs: totalHandballs,
        hitouts: totalHitouts,
        inside50s: totalInside50s,
        rebound50s: totalRebound50s,
        contestedPossessions: totalContested,
        intercepts: totalIntercepts,
        clearances: totalClearances,
        clangers: totalClangers,
        effectiveDisposals: totalEffectiveDisposals,
        contestedMarks: totalContestedMarks,
        metresGained: totalMetresGained,
        goalAssists: totalGoalAssists,
        scoreInvolvements: totalScoreInvolvements,
      },
    };

    logger.debug('Returning aggregated stats', {
      playerId,
      totalGames,
      averageScore: playerStats.averageScore,
    });
    return successResponse(playerStats);
  } catch (error) {
    logger.error('Failed to fetch player stats', error, { playerId: playerIdForLog });
    return commonErrors.internalServerError('Failed to fetch player stats');
  }
}
