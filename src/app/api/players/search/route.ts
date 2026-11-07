import { type NextRequest, NextResponse } from 'next/server';

import { getPlayers } from '@/lib/data';
import { logger } from '@/lib/logger';
import { calculateTotalValue, type PlayerStats } from '@/types/fantasyCategories';
import type { Player, PlayerSearchResult } from '@/types/players';
export const runtime = 'nodejs';

type SeasonStats = Player['stats'];

function seasonStat(stats: SeasonStats, key: string, fallback = 0): number {
  const value = Number(stats?.[key]);
  return stats?.[key] !== undefined && Number.isFinite(value) ? value : fallback;
}

/**
 * `player.stats` holds season totals (and per-game TOG and disposal efficiency) from
 * src/lib/data.ts; the player's top-level stat fields are the latest single match, so they are
 * not used. calculateTotalValue divides the totals by games, so its result is already per game.
 */
function seasonPerGameValue(stats: SeasonStats, games: number): number {
  const playerStats: PlayerStats = {
    games,
    kicks: seasonStat(stats, 'kicks'),
    handballs: seasonStat(stats, 'handballs'),
    marks: seasonStat(stats, 'marks'),
    tackles: seasonStat(stats, 'tackles'),
    goals: seasonStat(stats, 'goals'),
    hitouts: seasonStat(stats, 'hitouts'),
    clearances: seasonStat(stats, 'clearances'),
    inside50s: seasonStat(stats, 'inside50s'),
    rebound50s: seasonStat(stats, 'rebound50s'),
    clangers: seasonStat(stats, 'clangers'),
    contestedPossessions: seasonStat(stats, 'contestedPossessions'),
    uncontestedPossessions: seasonStat(stats, 'uncontestedPossessions'),
    freesFor: seasonStat(stats, 'freesFor'),
    freesAgainst: seasonStat(stats, 'freesAgainst'),
    onePercenters: seasonStat(stats, 'onePercenters'),
    goalAssists: seasonStat(stats, 'goalAssists'),
    timeOnGroundPct: seasonStat(stats, 'timeOnGroundPct', 85),
    disposalEffPct: seasonStat(stats, 'disposalEfficiency', 75),
    turnovers: seasonStat(stats, 'turnovers'),
    intercepts: seasonStat(stats, 'intercepts'),
    metresGained: seasonStat(stats, 'metresGained'),
    contestedMarks: seasonStat(stats, 'contestedMarks'),
    effectiveDisposals: seasonStat(stats, 'effectiveDisposals'),
    scoreInvolvements: seasonStat(stats, 'scoreInvolvements'),
  };
  return calculateTotalValue(playerStats);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query || query.length < 2) {
      return NextResponse.json({ players: [] });
    }

    // Search the canonical player list. Firestore player_match_stats is an ingestion projection,
    // and scanning it on every keystroke was an unauthenticated read-cost surface.
    const knownPlayers = await getPlayers();
    const seenIds = new Set<string>();
    const players: PlayerSearchResult[] = [];

    for (const player of knownPlayers) {
      if (seenIds.has(player.id)) continue;
      seenIds.add(player.id);

      const totalGames = typeof player.games === 'number' ? player.games : 1;
      const perGame = seasonPerGameValue(player.stats, totalGames);
      players.push({
        id: player.id,
        name: player.name,
        team: player.team ?? '',
        position: player.position ?? '',
        totalGames,
        totalScore: Math.round(perGame * totalGames),
        averageScore: Math.round(perGame),
        latestRound: 0,
      });
    }

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
