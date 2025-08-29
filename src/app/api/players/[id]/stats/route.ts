export const runtime = 'nodejs';

import { type NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { commonErrors, successResponse } from '@/lib/apiResponse';
import { calculateTotalValue, type PlayerStats } from '@/types/fantasyCategories';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    
    console.log(`🔍 Fetching stats for player: ${id}`);
    
    // Query player match stats for aggregation
    const snapshot = await adminDb
      .collection('player_match_stats')
      .where('player_name', '==', decodeURIComponent(id))
      .get();

    console.log(`📊 Found ${snapshot.size} records for ${id}`);

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
    let team = '';
    let position = '';
    
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      totalGames++;
      
      // Aggregate all stats for custom scoring calculation
      totalGoals += data.goals || 0;
      totalDisposals += data.disposals || 0;
      totalMarks += data.marks || 0;
      totalTackles += data.tackles || 0;
      totalKicks += data.kicks || 0;
      totalHandballs += data.handballs || 0;
      totalHitouts += data.hitouts || 0;
      totalInside50s += data.inside_50s || 0;
      totalRebound50s += data.rebound_50s || 0;
      totalContested += data.contested_possessions || 0;
      totalUncontested += data.uncontested_possessions || 0;
      totalIntercepts += data.intercepts || 0;
      totalClearances += data.clearances || 0;
      totalClangers += data.clangers || 0;
      totalFreesFor += data.frees_for || 0;
      totalFreesAgainst += data.frees_against || 0;
      totalOnePercenters += data.one_percenters || 0;
      totalGoalAssists += data.goal_assists || 0;
      totalTurnovers += data.turnovers || 0;
      totalMetresGained += data.metres_gained || 0;
      totalContestedMarks += data.contested_marks || 0;
      totalEffectiveDisposals += data.effective_disposals || 0;
      totalScoreInvolvements += data.score_involvements || 0;
      totalTimeOnGround += data.time_on_ground_percentage || 85; // Default if missing
      totalDisposalEfficiency += data.disposal_efficiency || 75; // Default if missing
      
      latestRound = Math.max(latestRound, data.round || 0);
      
      if (data.team) team = data.team;
      if (data.position) position = data.position;
    });

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
      playerName: decodeURIComponent(id),
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
        contestedPossessions: totalGames > 0 ? Math.round((totalContested / totalGames) * 10) / 10 : 0,
        intercepts: totalGames > 0 ? Math.round((totalIntercepts / totalGames) * 10) / 10 : 0,
        clearances: totalGames > 0 ? Math.round((totalClearances / totalGames) * 10) / 10 : 0,
        clangers: totalGames > 0 ? Math.round((totalClangers / totalGames) * 10) / 10 : 0,
        effectiveDisposals: totalGames > 0 ? Math.round((totalEffectiveDisposals / totalGames) * 10) / 10 : 0,
        contestedMarks: totalGames > 0 ? Math.round((totalContestedMarks / totalGames) * 10) / 10 : 0,
        metresGained: totalGames > 0 ? Math.round((totalMetresGained / totalGames) * 10) / 10 : 0,
        goalAssists: totalGames > 0 ? Math.round((totalGoalAssists / totalGames) * 10) / 10 : 0,
        scoreInvolvements: totalGames > 0 ? Math.round((totalScoreInvolvements / totalGames) * 10) / 10 : 0,
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

    console.log(`✅ Returning aggregated stats for ${id}: ${totalGames} games, avg score ${playerStats.averageScore}`);
    return successResponse(playerStats);
  } catch (error) {
    const { id } = await params;
    logger.error('Failed to fetch player stats', error, { playerId: id });
    return commonErrors.internalServerError('Failed to fetch player stats');
  }
}
