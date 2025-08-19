import { type NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { calculateTotalValue, type PlayerStats } from '@/types/fantasyCategories';

interface PlayerSearchResult {
  name: string;
  team: string;
  position: string;
  totalGames: number;
  averageScore: number;
  totalScore: number;
  latestRound: number;
}

interface PlayerAggregationData {
  name: string;
  team: string;
  position: string;
  totalGames: number;
  latestRound: number;
  // Accumulated stats
  totalGoals: number;
  totalKicks: number;
  totalHandballs: number;
  totalMarks: number;
  totalTackles: number;
  totalHitouts: number;
  totalClearances: number;
  totalInside50s: number;
  totalRebound50s: number;
  totalClangers: number;
  totalContested: number;
  totalUncontested: number;
  totalFreesFor: number;
  totalFreesAgainst: number;
  totalOnePercenters: number;
  totalGoalAssists: number;
  totalTurnovers: number;
  totalIntercepts: number;
  totalMetresGained: number;
  totalContestedMarks: number;
  totalEffectiveDisposals: number;
  totalScoreInvolvements: number;
  totalTimeOnGround: number;
  totalDisposalEfficiency: number;
}

export async function GET(_request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    
    if (!query || query.length < 2) {
      return NextResponse.json({ players: [] });
    }
    
    // Get all unique players with additional stats for better search results
    const snapshot = await adminDb.collection('player_match_stats').get();
    const playersMap = new Map<string, PlayerAggregationData>();
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.player_name) {
        const playerName = data.player_name;
        if (!playersMap.has(playerName)) {
          playersMap.set(playerName, {
            name: playerName,
            team: data.team || '',
            position: data.position || '',
            totalGames: 0,
            latestRound: 0,
            totalGoals: 0,
            totalKicks: 0,
            totalHandballs: 0,
            totalMarks: 0,
            totalTackles: 0,
            totalHitouts: 0,
            totalClearances: 0,
            totalInside50s: 0,
            totalRebound50s: 0,
            totalClangers: 0,
            totalContested: 0,
            totalUncontested: 0,
            totalFreesFor: 0,
            totalFreesAgainst: 0,
            totalOnePercenters: 0,
            totalGoalAssists: 0,
            totalTurnovers: 0,
            totalIntercepts: 0,
            totalMetresGained: 0,
            totalContestedMarks: 0,
            totalEffectiveDisposals: 0,
            totalScoreInvolvements: 0,
            totalTimeOnGround: 0,
            totalDisposalEfficiency: 0,
          });
        }
        
        const player = playersMap.get(playerName);
        if (player) {
          player.totalGames++;
          player.latestRound = Math.max(player.latestRound, data.round || 0);
          
          // Accumulate all stats
          player.totalGoals += data.goals || 0;
          player.totalKicks += data.kicks || 0;
          player.totalHandballs += data.handballs || 0;
          player.totalMarks += data.marks || 0;
          player.totalTackles += data.tackles || 0;
          player.totalHitouts += data.hitouts || 0;
          player.totalClearances += data.clearances || 0;
          player.totalInside50s += data.inside_50s || 0;
          player.totalRebound50s += data.rebound_50s || 0;
          player.totalClangers += data.clangers || 0;
          player.totalContested += data.contested_possessions || 0;
          player.totalUncontested += data.uncontested_possessions || 0;
          player.totalFreesFor += data.frees_for || 0;
          player.totalFreesAgainst += data.frees_against || 0;
          player.totalOnePercenters += data.one_percenters || 0;
          player.totalGoalAssists += data.goal_assists || 0;
          player.totalTurnovers += data.turnovers || 0;
          player.totalIntercepts += data.intercepts || 0;
          player.totalMetresGained += data.metres_gained || 0;
          player.totalContestedMarks += data.contested_marks || 0;
          player.totalEffectiveDisposals += data.effective_disposals || 0;
          player.totalScoreInvolvements += data.score_involvements || 0;
          player.totalTimeOnGround += data.time_on_ground_percentage || 85;
          player.totalDisposalEfficiency += data.disposal_efficiency || 75;
          
          // Use most recent team/position if available
          if (data.team) player.team = data.team;
          if (data.position) player.position = data.position;
        }
      }
    });
    
    // Calculate custom fantasy scores and create results
    const players: PlayerSearchResult[] = Array.from(playersMap.values()).map(player => {
      // Create PlayerStats object for custom scoring calculation
      const playerStats: PlayerStats = {
        games: player.totalGames,
        kicks: player.totalKicks,
        handballs: player.totalHandballs,
        marks: player.totalMarks,
        tackles: player.totalTackles,
        goals: player.totalGoals,
        hitouts: player.totalHitouts,
        clearances: player.totalClearances,
        inside50s: player.totalInside50s,
        rebound50s: player.totalRebound50s,
        clangers: player.totalClangers,
        contestedPossessions: player.totalContested,
        uncontestedPossessions: player.totalUncontested,
        freesFor: player.totalFreesFor,
        freesAgainst: player.totalFreesAgainst,
        onePercenters: player.totalOnePercenters,
        goalAssists: player.totalGoalAssists,
        timeOnGroundPct: player.totalGames > 0 ? player.totalTimeOnGround / player.totalGames : 85,
        disposalEffPct: player.totalGames > 0 ? player.totalDisposalEfficiency / player.totalGames : 75,
        turnovers: player.totalTurnovers,
        intercepts: player.totalIntercepts,
        metresGained: player.totalMetresGained,
        contestedMarks: player.totalContestedMarks,
        effectiveDisposals: player.totalEffectiveDisposals,
        scoreInvolvements: player.totalScoreInvolvements,
      };
      
      // Calculate custom fantasy score using your algorithm
      const customTotalScore = calculateTotalValue(playerStats);
      const customAverageScore = player.totalGames > 0 ? Math.round(customTotalScore / player.totalGames) : 0;
      
      return {
        name: player.name,
        team: player.team,
        position: player.position,
        totalGames: player.totalGames,
        totalScore: customTotalScore,
        averageScore: customAverageScore,
        latestRound: player.latestRound,
      };
    });
    
    // Filter players by search query (case insensitive, search name and team)
    const filteredPlayers = players
      .filter(player => 
        player.name.toLowerCase().includes(query.toLowerCase()) ||
        player.team.toLowerCase().includes(query.toLowerCase())
      )
      .sort((a, b) => {
        // Sort by relevance: exact match first, then by average score
        const aExact = a.name.toLowerCase().startsWith(query.toLowerCase()) ? 1 : 0;
        const bExact = b.name.toLowerCase().startsWith(query.toLowerCase()) ? 1 : 0;
        
        if (aExact !== bExact) return bExact - aExact;
        return b.averageScore - a.averageScore;
      })
      .slice(0, 20); // Limit to 20 results
    
    return NextResponse.json({ players: filteredPlayers });
  } catch (error) {
    console.error('Error searching players:', error);
    return NextResponse.json(
      { error: 'Failed to search players' },
      { status: 500 }
    );
  }
}
