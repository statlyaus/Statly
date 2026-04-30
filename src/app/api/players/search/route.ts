import { type NextRequest, NextResponse } from 'next/server';

import { getDefaultAflSeason } from '@/lib/aflSeason';
import { getPlayers } from '@/lib/data';
import { logger } from '@/lib/logger';
import { statsReadService, type PlayerProjectionSummary } from '@/server/stats/StatsReadService';
import { calculateTotalValue, type PlayerStats } from '@/types/fantasyCategories';
import type { Player, PlayerSearchResult } from '@/types/players';
export const runtime = 'nodejs';

function readNumeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function buildPlayerStats(player: Player, totalGames: number): PlayerStats {
  const stats = player.stats ?? {};
  return {
    games: totalGames,
    kicks: readNumeric(player.kicks ?? stats.kicks),
    handballs: readNumeric(player.handballs ?? stats.handballs),
    marks: readNumeric(player.marks ?? stats.marks),
    tackles: readNumeric(player.tackles ?? stats.tackles),
    goals: readNumeric(player.goals ?? stats.goals),
    hitouts: readNumeric(player.hitouts ?? stats.hitouts),
    clearances: readNumeric(player.clearances ?? stats.clearances),
    inside50s: readNumeric(player.inside50s ?? stats.inside50s),
    rebound50s: readNumeric(player.rebound50s ?? stats.rebound50s),
    clangers: readNumeric(stats.clangers),
    contestedPossessions: readNumeric(player.contestedPossessions ?? stats.contestedPossessions),
    uncontestedPossessions: readNumeric(stats.uncontestedPossessions),
    freesFor: readNumeric(stats.freesFor),
    freesAgainst: readNumeric(stats.freesAgainst),
    onePercenters: readNumeric(stats.onePercenters),
    goalAssists: readNumeric(stats.goalAssists),
    timeOnGroundPct: 85,
    disposalEffPct: 75,
    turnovers: readNumeric(stats.turnovers),
    intercepts: readNumeric(stats.intercepts),
    metresGained: readNumeric(stats.metresGained),
    contestedMarks: readNumeric(stats.contestedMarks),
    effectiveDisposals: readNumeric(stats.effectiveDisposals),
    scoreInvolvements: readNumeric(stats.scoreInvolvements),
  };
}

function compareSearchRelevance(queryLower: string, a: Player, b: Player): number {
  const score = (player: Player): number => {
    const name = player.name.toLowerCase();
    if (name === queryLower) return 4;
    if (name.startsWith(queryLower)) return 3;
    if (name.split(/\s+/).some((part) => part.startsWith(queryLower))) return 2;
    if (name.includes(queryLower)) return 1;
    return 0;
  };

  const scoreDiff = score(b) - score(a);
  if (scoreDiff !== 0) return scoreDiff;
  return a.name.localeCompare(b.name);
}

async function getSearchProjectionSummaries(
  candidatePlayerIds: string[]
): Promise<Map<string, PlayerProjectionSummary>> {
  try {
    const season = await statsReadService.resolveSeason(getDefaultAflSeason());
    await statsReadService.ensureSeasonReady(season);
    return await statsReadService.getSeasonSummaryMap(season, candidatePlayerIds);
  } catch (error) {
    logger.warn(
      'Player search projection enrichment unavailable; falling back to local player data',
      {
        candidateCount: candidatePlayerIds.length,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    return new Map();
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query || query.length < 2) {
      return NextResponse.json({ players: [] });
    }

    const knownPlayers = await getPlayers();
    const queryLower = query.toLowerCase().trim();
    const candidatePlayers = knownPlayers
      .filter((player) => {
        const name = player.name.toLowerCase();
        return (
          name.includes(queryLower) ||
          (player.team ?? '').toLowerCase().includes(queryLower) ||
          (player.position ?? '').toLowerCase().includes(queryLower) ||
          name.split(/\s+/).some((part) => part.includes(queryLower))
        );
      })
      .sort((a, b) => compareSearchRelevance(queryLower, a, b))
      .slice(0, 40);

    const statsById = await getSearchProjectionSummaries(
      candidatePlayers.map((player) => player.id)
    );

    const filteredPlayers = candidatePlayers
      .map((player) => {
        const projected = statsById.get(player.id);
        const totalGames =
          projected?.gamesPlayed ?? (typeof player.games === 'number' ? player.games : 0);
        const playerStats = projected
          ? {
              ...projected.totals,
              games: projected.gamesPlayed,
              timeOnGroundPct:
                projected.gamesPlayed > 0
                  ? readNumeric(projected.totals.timeOnGroundPct) / projected.gamesPlayed
                  : 85,
              disposalEffPct:
                projected.gamesPlayed > 0
                  ? readNumeric(projected.totals.disposalEffPct) / projected.gamesPlayed
                  : 75,
            }
          : buildPlayerStats(player, totalGames || 1);
        const totalScore = calculateTotalValue(playerStats);
        const averageScore = totalGames > 0 ? Math.round(totalScore / totalGames) : 0;

        return {
          id: player.id,
          name: player.name,
          team: player.team ?? '',
          position: player.position ?? '',
          totalGames,
          totalScore,
          averageScore,
          latestRound: 0,
        } satisfies PlayerSearchResult;
      })
      .sort((a, b) => {
        const relevance = compareSearchRelevance(queryLower, a as Player, b as Player);
        if (relevance !== 0) return relevance;
        return b.averageScore - a.averageScore;
      })
      .slice(0, 20);

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
