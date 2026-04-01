import { logger } from '@/lib/logger';
import { redisClient } from '@/lib/redis';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';

export type MatchupTeamPayload = {
  userId: string;
  memberId: string;
  teamName: string;
  starters: Array<{
    id: string;
    name: string;
    team: string;
    position: string;
    stats: Record<string, number | undefined>;
  }>;
  summary: { wins: number; losses: number; ties: number };
};

export type MatchupCategoryPayload = {
  key: FantasyCategoryKey;
  label: string;
  home: number;
  away: number;
  winner: 'home' | 'away' | 'tie';
};

export type CachedMatchupPayload = {
  matchupId: string;
  home: MatchupTeamPayload;
  away: MatchupTeamPayload;
  categories: MatchupCategoryPayload[];
};

export type CachedMatchupSlate = {
  leagueId: string;
  leagueName: string;
  season: number;
  round: number;
  roundLabel: string;
  status: 'scheduled' | 'in_progress' | 'final';
  live: boolean;
  lastUpdated: string | null;
  completedTeams?: string[];
  matchups: CachedMatchupPayload[];
};

export type MatchupSummaryPayload = {
  matchupId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  leaderText: string;
  isSelected: boolean;
};

export const LIVE_MATCHUP_CACHE_TTL_SECONDS = 15;
export const STATIC_MATCHUP_CACHE_TTL_SECONDS = 300;

export function buildLeaderText(
  homeTeamName: string,
  awayTeamName: string,
  homeScore: number,
  awayScore: number
): string {
  if (homeScore === awayScore) {
    return `${homeTeamName} and ${awayTeamName} tied ${homeScore}-${awayScore}`;
  }

  return homeScore > awayScore
    ? `${homeTeamName} leads ${homeScore}-${awayScore}`
    : `${awayTeamName} leads ${awayScore}-${homeScore}`;
}

export function buildSlateCacheKey(
  leagueId: string,
  season: number,
  round: number,
  categories: FantasyCategoryKey[]
): string {
  return `league-matchup:${leagueId}:${season}:${round}:${[...categories].sort().join(',')}`;
}

export async function getCachedSlate(key: string): Promise<CachedMatchupSlate | null> {
  try {
    if (!redisClient.isConnected()) {
      await redisClient.connect();
    }
    const cached = await redisClient.get(key);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as CachedMatchupSlate;
    return parsed && Array.isArray(parsed.matchups) ? parsed : null;
  } catch (error) {
    logger.warn('Failed to read cached matchup slate', {
      error: error instanceof Error ? error.message : String(error),
      key,
    });
    return null;
  }
}

export async function setCachedSlate(
  key: string,
  slate: CachedMatchupSlate,
  ttlSeconds: number
): Promise<void> {
  try {
    if (!redisClient.isConnected()) {
      await redisClient.connect();
    }
    await redisClient.set(key, JSON.stringify(slate), ttlSeconds);
  } catch (error) {
    logger.warn('Failed to write cached matchup slate', {
      error: error instanceof Error ? error.message : String(error),
      key,
      ttlSeconds,
    });
  }
}

function swapWinner(winner: 'home' | 'away' | 'tie'): 'home' | 'away' | 'tie' {
  if (winner === 'home') return 'away';
  if (winner === 'away') return 'home';
  return 'tie';
}

export function orientCachedMatchup(
  matchup: CachedMatchupPayload,
  authUserId: string,
  myCurrentMatchupId: string
): CachedMatchupPayload {
  const shouldSwap = matchup.matchupId === myCurrentMatchupId && matchup.away.userId === authUserId;
  if (!shouldSwap) return matchup;

  return {
    matchupId: matchup.matchupId,
    home: matchup.away,
    away: matchup.home,
    categories: matchup.categories.map((category) => ({
      ...category,
      home: category.away,
      away: category.home,
      winner: swapWinner(category.winner),
    })),
  };
}

export function buildOtherMatchupSummaries(
  slate: CachedMatchupSlate,
  selectedMatchupId: string
): MatchupSummaryPayload[] {
  return slate.matchups
    .filter((matchup) => matchup.matchupId !== selectedMatchupId)
    .map((matchup) => ({
      matchupId: matchup.matchupId,
      homeTeamName: matchup.home.teamName,
      awayTeamName: matchup.away.teamName,
      homeScore: matchup.home.summary.wins,
      awayScore: matchup.away.summary.wins,
      leaderText: buildLeaderText(
        matchup.home.teamName,
        matchup.away.teamName,
        matchup.home.summary.wins,
        matchup.away.summary.wins
      ),
      isSelected: false,
    }));
}
