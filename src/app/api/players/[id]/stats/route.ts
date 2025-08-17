export const runtime = 'nodejs';

import { type NextRequest } from 'next/server';
import { logger } from '@/lib/logger';
import { commonErrors, successResponse } from '@/lib/apiResponse';
import { adminDb } from '@/lib/firebaseAdmin';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    
    // Decode the ID in case it's URL encoded
    const decodedId = decodeURIComponent(id);
    
    // Determine if this is a player name or a document ID format
    let playerName: string;
    if (decodedId.includes('_2025_')) {
      // This looks like a document ID (e.g., "aaron_cadman_2025_1")
      // Extract player name from document ID format
      const parts = decodedId.split('_2025_')[0];
      playerName = parts.split('_').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      ).join(' ');
    } else {
      // This is already a player name
      playerName = decodedId;
    }
    
    // Get all match records for this player to calculate statistics
    const matchesRef = adminDb.collection('player_match_stats');
    const snapshot = await matchesRef
      .where('player_name', '==', playerName)
      .get();

    if (snapshot.empty) {
      return commonErrors.notFound('No statistics found for this player');
    }

    const matches = snapshot.docs.map(doc => doc.data());
    const gamesPlayed = matches.length;
    
    // Calculate season totals and averages
    const totals = {
      games: gamesPlayed,
      disposals: 0,
      kicks: 0,
      handballs: 0,
      marks: 0,
      goals: 0,
      behinds: 0,
      tackles: 0,
      hitouts: 0,
      inside50s: 0,
      rebound50s: 0,
      clangers: 0,
      contestedPossessions: 0,
      uncontestePossessions: 0,
      effectiveDisposals: 0,
      contestedMarks: 0,
      intercepts: 0,
      supercoachScore: 0,
      playerValue: 0,
    };

    // Sum up all stats
    matches.forEach(match => {
      totals.disposals += match.disposals || 0;
      totals.kicks += match.kicks || 0;
      totals.handballs += match.handballs || 0;
      totals.marks += match.marks || 0;
      totals.goals += match.goals || 0;
      totals.behinds += match.behinds || 0;
      totals.tackles += match.tackles || 0;
      totals.hitouts += match.hitouts || 0;
      totals.inside50s += match.inside_50s || 0;
      totals.rebound50s += match.rebound_50s || 0;
      totals.clangers += match.clangers || 0;
      totals.contestedPossessions += match.contested_possessions || 0;
      totals.uncontestePossessions += match.uncontested_possessions || 0;
      totals.effectiveDisposals += match.effective_disposals || 0;
      totals.contestedMarks += match.contested_marks || 0;
      totals.intercepts += match.intercepts || 0;
      totals.supercoachScore += match.supercoach_score || 0;
      totals.playerValue += match.player_value || 0;
    });

    // Calculate averages
    const averages = Object.fromEntries(
      Object.entries(totals).map(([key, value]) => [
        key,
        key === 'games' ? value : gamesPlayed > 0 ? +(value / gamesPlayed).toFixed(1) : 0
      ])
    );

    // Calculate disposal efficiency
    const totalEffectiveDisposals = totals.effectiveDisposals;
    const totalDisposals = totals.disposals;
    const disposalEfficiency = totalDisposals > 0 ? +((totalEffectiveDisposals / totalDisposals) * 100).toFixed(1) : 0;

    // Get player info from first match
    const firstMatch = matches[0];
    const playerInfo = {
      name: firstMatch.player_name,
      team: firstMatch.team,
      position: firstMatch.position || 'Unknown', // Add position if available in data
    };

    // Get recent form (last 5 games)
    const recentMatches = matches
      .sort((a, b) => b.round - a.round)
      .slice(0, 5);
    
    const recentForm = recentMatches.map(match => ({
      round: match.round,
      supercoachScore: match.supercoach_score || 0,
      playerValue: match.player_value || 0,
      opposition: match.opposition,
    }));

    // Calculate form averages
    const recentTotals = {
      supercoachScore: 0,
      playerValue: 0,
    };

    recentMatches.forEach(match => {
      recentTotals.supercoachScore += match.supercoach_score || 0;
      recentTotals.playerValue += match.player_value || 0;
    });

    const recentAverages = {
      supercoachScore: recentMatches.length > 0 ? +(recentTotals.supercoachScore / recentMatches.length).toFixed(1) : 0,
      playerValue: recentMatches.length > 0 ? +(recentTotals.playerValue / recentMatches.length).toFixed(1) : 0,
    };

    const statistics = {
      player: playerInfo,
      season: {
        totals,
        averages,
        disposalEfficiency,
      },
      recentForm: {
        games: recentMatches.length,
        matches: recentForm,
        averages: recentAverages,
      },
      performance: {
        highestScore: Math.max(...matches.map(m => m.supercoach_score || 0)),
        lowestScore: Math.min(...matches.map(m => m.supercoach_score || 0)),
        mostGoals: Math.max(...matches.map(m => m.goals || 0)),
        mostDisposals: Math.max(...matches.map(m => m.disposals || 0)),
        consistency: calculateConsistency(matches.map(m => m.supercoach_score || 0)),
      }
    };

    logger.info(`Retrieved statistics for player: ${playerName} (id: ${id})`);
    return successResponse(statistics);

  } catch (error) {
    const { id } = await params;
    logger.error('Failed to fetch player statistics', error, { playerId: id });
    return commonErrors.internalServerError('Failed to fetch player statistics');
  }
}

function calculateConsistency(scores: number[]): number {
  if (scores.length === 0) return 0;
  
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;
  const standardDeviation = Math.sqrt(variance);
  
  // Return coefficient of variation as a percentage (lower is more consistent)
  return mean > 0 ? +((standardDeviation / mean) * 100).toFixed(1) : 0;
}
