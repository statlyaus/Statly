import { type NextRequest, NextResponse } from 'next/server';

import { getPlayers } from '@/lib/data';
import { logger } from '@/lib/logger';
import { calculateTotalValue, type PlayerStats } from '@/types/fantasyCategories';
import type { PlayerSearchResult } from '@/types/players';
export const runtime = 'nodejs';

interface PlayerAggregationData {
  id: string;
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query || query.length < 2) {
      return NextResponse.json({ players: [] });
    }

    const knownPlayers = await getPlayers();
    // Search the canonical player list. Firestore player_match_stats is an ingestion projection,
    // and scanning it on every keystroke was an unauthenticated read-cost surface.
    const playersMap = new Map<string, PlayerAggregationData>();
    const jsonPlayers = knownPlayers;

    jsonPlayers.forEach((player) => {
      if (!playersMap.has(player.id)) {
        // Calculate stats from player data
        const goals =
          typeof player.goals === 'number'
            ? player.goals
            : typeof player.stats?.goals === 'number'
              ? player.stats.goals
              : 0;
        const kicks =
          typeof player.kicks === 'number'
            ? player.kicks
            : typeof player.stats?.kicks === 'number'
              ? player.stats.kicks
              : 0;
        const handballs =
          typeof player.handballs === 'number'
            ? player.handballs
            : typeof player.stats?.handballs === 'number'
              ? player.stats.handballs
              : 0;
        const marks =
          typeof player.marks === 'number'
            ? player.marks
            : typeof player.stats?.marks === 'number'
              ? player.stats.marks
              : 0;
        const tackles =
          typeof player.tackles === 'number'
            ? player.tackles
            : typeof player.stats?.tackles === 'number'
              ? player.stats.tackles
              : 0;
        const hitouts =
          typeof player.hitouts === 'number'
            ? player.hitouts
            : typeof player.stats?.hitouts === 'number'
              ? player.stats.hitouts
              : 0;
        const clearances =
          typeof player.clearances === 'number'
            ? player.clearances
            : typeof player.stats?.clearances === 'number'
              ? player.stats.clearances
              : 0;
        const inside50s =
          typeof player.inside50s === 'number'
            ? player.inside50s
            : typeof player.stats?.inside50s === 'number'
              ? player.stats.inside50s
              : 0;
        const rebound50s =
          typeof player.rebound50s === 'number'
            ? player.rebound50s
            : typeof player.stats?.rebound50s === 'number'
              ? player.stats.rebound50s
              : 0;
        const contestedPossessions =
          typeof player.contestedPossessions === 'number'
            ? player.contestedPossessions
            : typeof player.stats?.contestedPossessions === 'number'
              ? player.stats.contestedPossessions
              : 0;
        const effectiveDisposals =
          typeof player.stats?.effectiveDisposals === 'number'
            ? player.stats.effectiveDisposals
            : 0;
        const scoreInvolvements =
          typeof player.stats?.scoreInvolvements === 'number' ? player.stats.scoreInvolvements : 0;
        const intercepts =
          typeof player.stats?.intercepts === 'number' ? player.stats.intercepts : 0;
        const contestedMarks =
          typeof player.stats?.contestedMarks === 'number' ? player.stats.contestedMarks : 0;
        const metresGained =
          typeof player.stats?.metresGained === 'number' ? player.stats.metresGained : 0;

        playersMap.set(player.id, {
          id: player.id,
          name: player.name,
          team: player.team || '',
          position: player.position || '',
          totalGames: typeof player.games === 'number' ? player.games : 1,
          latestRound: 0,
          totalGoals: goals,
          totalKicks: kicks,
          totalHandballs: handballs,
          totalMarks: marks,
          totalTackles: tackles,
          totalHitouts: hitouts,
          totalClearances: clearances,
          totalInside50s: inside50s,
          totalRebound50s: rebound50s,
          totalClangers: 0,
          totalContested: contestedPossessions,
          totalUncontested: 0,
          totalFreesFor: 0,
          totalFreesAgainst: 0,
          totalOnePercenters: 0,
          totalGoalAssists: 0,
          totalTurnovers: 0,
          totalIntercepts: intercepts,
          totalMetresGained: metresGained,
          totalContestedMarks: contestedMarks,
          totalEffectiveDisposals: effectiveDisposals,
          totalScoreInvolvements: scoreInvolvements,
          totalTimeOnGround: 85,
          totalDisposalEfficiency: 75,
        });
      }
    });

    // Calculate custom fantasy scores and create results
    const players: PlayerSearchResult[] = Array.from(playersMap.values()).map((player) => {
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
        disposalEffPct:
          player.totalGames > 0 ? player.totalDisposalEfficiency / player.totalGames : 75,
        turnovers: player.totalTurnovers,
        intercepts: player.totalIntercepts,
        metresGained: player.totalMetresGained,
        contestedMarks: player.totalContestedMarks,
        effectiveDisposals: player.totalEffectiveDisposals,
        scoreInvolvements: player.totalScoreInvolvements,
      };

      // Calculate custom fantasy score using your algorithm
      const customTotalScore = calculateTotalValue(playerStats);
      const customAverageScore =
        player.totalGames > 0 ? Math.round(customTotalScore / player.totalGames) : 0;

      return {
        id: player.id,
        name: player.name,
        team: player.team ?? '',
        position: player.position ?? '',
        totalGames: player.totalGames,
        totalScore: customTotalScore,
        averageScore: customAverageScore,
        latestRound: player.latestRound,
      };
    });

    // Filter players by search query (case insensitive, search name, team, and position)
    const queryLower = query.toLowerCase().trim();
    const filteredPlayers = players
      .filter(
        (player) =>
          player.name.toLowerCase().includes(queryLower) ||
          (player.team ?? '').toLowerCase().includes(queryLower) ||
          (player.position ?? '').toLowerCase().includes(queryLower) ||
          // Also check if any part of the name matches (e.g., "naughton" matches "Aaron Naughton")
          player.name
            .toLowerCase()
            .split(' ')
            .some((part: string) => part.includes(queryLower))
      )
      .sort((a, b) => {
        // Sort by relevance: exact match first, then starts with, then by average score
        const aExact =
          a.name.toLowerCase() === queryLower
            ? 2
            : a.name.toLowerCase().startsWith(queryLower)
              ? 1
              : 0;
        const bExact =
          b.name.toLowerCase() === queryLower
            ? 2
            : b.name.toLowerCase().startsWith(queryLower)
              ? 1
              : 0;

        if (aExact !== bExact) return bExact - aExact;
        return b.averageScore - a.averageScore;
      })
      .slice(0, 20); // Limit to 20 results

    return NextResponse.json({ players: filteredPlayers });
  } catch (error) {
    logger.error(
      'Error searching players',
      error instanceof Error ? error : new Error(String(error)),
      {
        query: new URL(request.url).searchParams.get('q'),
      }
    );
    return NextResponse.json({ error: 'Failed to search players' }, { status: 500 });
  }
}
